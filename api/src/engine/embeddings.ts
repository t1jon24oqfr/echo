// Echo — Phase 3 embeddings (design spec §7 step 2; FEATURES_V12 Backend §4).
//
// Generative-Agents retrieval needs a relevance term = cosine(query, memory).
// We embed each Memory ONCE at write-time (or lazily on read) with EMBED_MODEL
// and store the vector as a JSON string on Memory.embedding. The cosine /
// scoring math is PURE + unit-tested; only embedText does network I/O.
//
// PROVIDER: OpenRouter exposes an OpenAI-compatible /embeddings endpoint; fal has
// embedding models too. We default to OpenRouter (same key/base as chat) and fall
// back to fal only if EMBED_PROVIDER=fal. Env is read at CALL-TIME (never cached).
// CRITICAL: the chat turn NEVER awaits an embed — retrieval works without one
// (keyword fallback) and backfill is fire-and-forget.

const DEFAULT_EMBED_MODEL = 'openai/text-embedding-3-small';

/** Read the embedding model id at call-time (env override). */
export function embedModel(): string {
  return process.env.EMBED_MODEL ?? DEFAULT_EMBED_MODEL;
}

/** True when an embeddings provider is configured (OpenRouter key, or fal). */
export function hasEmbedKey(): boolean {
  const provider = (process.env.EMBED_PROVIDER ?? 'openrouter').toLowerCase();
  if (provider === 'fal') return Boolean(process.env.FAL_KEY);
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Embed a single piece of text into a float vector. Throws on transport / config
 * failure (callers swallow — embeddings are best-effort, never block a turn).
 */
export async function embedText(text: string): Promise<number[]> {
  const t = (text ?? '').trim();
  if (!t) throw new Error('embedText: empty input');
  const provider = (process.env.EMBED_PROVIDER ?? 'openrouter').toLowerCase();
  if (provider === 'fal') return embedViaFal(t);
  return embedViaOpenRouter(t);
}

async function embedViaOpenRouter(text: string): Promise<number[]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('NO_EMBED_KEY');
  const base = process.env.OPENAI_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'persona-web',
    },
    body: JSON.stringify({ model: embedModel(), input: text }),
  });
  if (!res.ok) throw new Error(`EMBED ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = data.data?.[0]?.embedding;
  if (!Array.isArray(vec) || !vec.length) throw new Error('EMBED: empty vector');
  return vec.map(Number);
}

async function embedViaFal(text: string): Promise<number[]> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('NO_FAL_KEY');
  const model = process.env.EMBED_MODEL ?? 'fal-ai/text-embeddings';
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`EMBED(fal) ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { embedding?: number[]; embeddings?: number[][] };
  const vec = data.embedding ?? data.embeddings?.[0];
  if (!Array.isArray(vec) || !vec.length) throw new Error('EMBED(fal): empty vector');
  return vec.map(Number);
}

// ----------------------------------------------------------------------------
// PURE math — cosine + safe (de)serialization. Unit-tested.
// ----------------------------------------------------------------------------

/** Cosine similarity of two equal-length vectors in [-1,1]; 0 on mismatch/zero. */
export function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Parse a stored embedding JSON string into a number[]; null when absent/invalid. */
export function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || !arr.length) return null;
    const out = arr.map(Number);
    return out.every((x) => Number.isFinite(x)) ? out : null;
  } catch {
    return null;
  }
}

export function serializeEmbedding(vec: number[]): string {
  // Round to 6 sig-figs to keep the JSON column small without hurting cosine.
  return JSON.stringify(vec.map((x) => Number(x.toFixed(6))));
}
