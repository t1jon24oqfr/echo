import 'dotenv/config';

const BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://openrouter.ai/api/v1';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error('OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'X-Title': 'persona-proto',
  };
}

export async function complete(opts: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2000,
      // best-effort privacy: avoid providers that retain/train on prompts
      provider: { data_collection: 'deny' },
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? '';
}

export async function streamChat(
  opts: { model: string; messages: ChatMessage[]; temperature?: number },
  onToken: (t: string) => void,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.8,
      stream: true,
      provider: { data_collection: 'deny' },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const tok = json.choices?.[0]?.delta?.content;
        if (tok) {
          full += tok;
          onToken(tok);
        }
      } catch {
        // ignore keep-alive lines
      }
    }
  }
  return full;
}

export async function completeJson<T>(opts: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await complete(opts);
    const stripped = raw
      .replace(/^[\s\S]*?```(?:json)?\s*/m, (m) => (raw.includes('```') ? '' : m))
      .replace(/```[\s\S]*$/m, '')
      .trim();
    const candidate = stripped.startsWith('{') || stripped.startsWith('[') ? stripped : raw.trim();
    try {
      return JSON.parse(candidate) as T;
    } catch {
      if (attempt === 1) throw new Error(`Model did not return valid JSON:\n${raw.slice(0, 500)}`);
    }
  }
  throw new Error('unreachable');
}

export const EXTRACT_MODEL = process.env.EXTRACT_MODEL ?? 'deepseek/deepseek-chat';
export const CHAT_MODEL = process.env.CHAT_MODEL ?? 'qwen/qwen3-32b';
