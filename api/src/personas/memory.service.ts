import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { completeJson, EXTRACT_MODEL, hasApiKey } from '../engine/llm';
import type { MemoryItem } from '../engine/types';
import { embedText, hasEmbedKey, serializeEmbedding } from '../engine/embeddings';

const RECENT_WINDOW = 50; // how many recent memories to dedupe against
const MAX_NEW_PER_TURN = 3; // cap per completed exchange
const DEDUPE_PREFIX = 60; // normalized-text prefix length used as dedupe key
const REFLECT_EVERY = 20; // consolidate into beliefs every N new episodic memories
const REFLECT_MIN = 15; // don't reflect until there's enough to generalize from

// Feeling-word lexicon (UA/RU/EN, prefix-matched) for the importance heuristic.
// Kept tiny + multilingual — a poignant memory should score higher.
const FEELING_PREFIXES = [
  // EN
  'love', 'miss', 'happy', 'sad', 'afraid', 'fear', 'angry', 'cry', 'hurt', 'proud', 'sorry',
  'hope', 'worri', 'lonel', 'grief', 'joy', 'hate', 'dream', 'promis',
  // UA/RU (cyrillic)
  'любл', 'кохаю', 'скуч', 'сумую', 'щаслив', 'сумн', 'боюс', 'страх', 'злюс', 'плак', 'болит',
  'болить', 'горд', 'вибач', 'прост', 'надія', 'хвилю', 'самотн', 'мрі', 'мечт', 'обіця', 'обеща',
  'люблю', 'счаст', 'груст', 'жаль',
];

// First-person markers (UA/RU/EN) — disclosures about oneself are more memorable.
// NB: JS \b is ASCII-only, so Cyrillic pronouns are matched with explicit
// non-letter / start / end boundaries instead of \b.
const FIRST_PERSON = [
  /\bi\b/i,
  /\bi'?m\b/i,
  /\bmy\b/i,
  /\bme\b/i,
  /(^|[^\p{L}])я([^\p{L}]|$)/iu,
  /(^|[^\p{L}])мен/iu,
  /(^|[^\p{L}])мі[йя]/iu,
  /(^|[^\p{L}])мо[яеёюї]/iu,
];

/**
 * Cheap heuristic poignancy 1..10 for a memory (NO LLM). Blends:
 *   - length (longer = more substantive)
 *   - presence of a feeling word (emotional disclosure > facts — design §5)
 *   - first-person voice
 *   - a concrete date
 * Default sits near 5. Used at both build-time and live write-time.
 */
export function memoryImportance(text: string, date?: string | null): number {
  const t = (text ?? '').trim();
  if (!t) return 5;
  const lower = t.toLowerCase();
  let score = 4; // base, slightly below midpoint so neutral facts land ~5-6
  const words = t.split(/\s+/).length;
  if (words >= 8) score += 1;
  if (words >= 16) score += 1;
  const hasFeeling = FEELING_PREFIXES.some((p) => lower.includes(p));
  if (hasFeeling) score += 2;
  const hasFirstPerson = FIRST_PERSON.some((re) => re.test(t));
  if (hasFirstPerson) score += 1;
  const hasDate = Boolean(date) || /\b(19|20)\d{2}\b/.test(t) || /\d{1,2}[./-]\d{1,2}/.test(t);
  if (hasDate) score += 1;
  return Math.max(1, Math.min(10, score));
}

/**
 * Live memory: after each completed chat turn, extract 0-3 NEW durable memories
 * from the latest exchange and append them as Memory rows. Fire-and-forget — the
 * caller never awaits this on the SSE response path; all failures are swallowed.
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extract + persist new memories from one exchange. Never throws.
   * @param personaId    persona owning the memories
   * @param personaAuthor the persona's name (memory POV)
   * @param userAuthor   the human's name
   * @param userText     the user's turn text (transcript for voice)
   * @param replyText    the persona's reply text
   */
  async learnFromTurn(
    personaId: string,
    personaAuthor: string,
    userAuthor: string,
    userText: string,
    // The persona's OWN reply is intentionally NOT mined for memories (R3): a
    // detail the model invents in a reply would otherwise become a "remembered
    // fact" that hardens future replies — a self-reinforcing confabulation loop,
    // the worst failure mode for a memorial. Only the human's turn is ground
    // truth. Kept in the signature for the caller; deliberately unused.
    _replyText: string,
  ): Promise<void> {
    try {
      if (!hasApiKey()) return;
      const u = (userText ?? '').trim();
      if (!u) return;

      const now = new Date();
      const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      const extracted = await this.extract(personaAuthor, userAuthor, u);
      if (!extracted.length) return;

      // Dedupe against the persona's recent memories by normalized-text prefix.
      const recent = await this.prisma.memory.findMany({
        where: { personaId },
        orderBy: { id: 'desc' },
        take: RECENT_WINDOW,
        select: { text: true },
      });
      const seen = new Set(recent.map((m) => normKey(m.text)));

      const fresh: MemoryItem[] = [];
      for (const m of extracted) {
        if (!m || typeof m.text !== 'string') continue;
        const text = m.text.trim();
        if (text.length < 3) continue;
        const key = normKey(text);
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push({ text, keywords: Array.isArray(m.keywords) ? m.keywords : [], date: m.date || date });
        if (fresh.length >= MAX_NEW_PER_TURN) break;
      }
      if (!fresh.length) return;

      await this.prisma.memory.createMany({
        data: fresh.map((m) => ({
          personaId,
          text: m.text,
          keywords: JSON.stringify(m.keywords ?? []),
          date: m.date || null,
          importance: memoryImportance(m.text, m.date),
          source: 'user', // derived from the human's turn = ground truth (R3)
        })),
      });
      this.logger.log(`live memory: +${fresh.length} for persona ${personaId}`);
      // Embed the just-written rows once (fire-and-forget; never blocks a turn).
      void this.backfillEmbeddings(personaId).catch(() => undefined);

      // Reflection trigger (Generative-Agents): every REFLECT_EVERY new episodic
      // memories, consolidate into higher-level beliefs. Off the hot path.
      const total = await this.prisma.memory.count({
        where: { personaId, kind: { not: 'reflection' } },
      });
      const before = total - fresh.length;
      if (total >= REFLECT_MIN && Math.floor(total / REFLECT_EVERY) > Math.floor(before / REFLECT_EVERY)) {
        void this.reflect(personaId, personaAuthor).catch(() => undefined);
      }
    } catch (e) {
      this.logger.warn(`live memory extract failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Consolidate recent episodic memories into up to 5 higher-level BELIEFS
   * (Generative-Agents reflection) — "gets anxious before exams", "teases when
   * affectionate". These are what make a knower say "that's them" (personality,
   * not trivia); retrieval boosts kind='reflection'. Never throws; off the hot path.
   */
  async reflect(personaId: string, personaAuthor: string): Promise<void> {
    try {
      if (!hasApiKey()) return;
      const rows = await this.prisma.memory.findMany({
        where: { personaId, kind: { not: 'reflection' } },
        orderBy: { id: 'desc' },
        take: 60,
        select: { text: true },
      });
      if (rows.length < 12) return;
      const existing = await this.prisma.memory.findMany({
        where: { personaId, kind: 'reflection' },
        orderBy: { id: 'desc' },
        take: 40,
        select: { text: true },
      });
      const seen = new Set(existing.map((m) => normKey(m.text)));

      const insights = await this.reflectExtract(personaAuthor, rows.map((r) => r.text));
      const now = new Date();
      const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const fresh: MemoryItem[] = [];
      for (const ins of insights) {
        if (!ins || typeof ins.text !== 'string') continue;
        const text = ins.text.trim();
        if (text.length < 8) continue;
        const key = normKey(text);
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push({ text, keywords: Array.isArray(ins.keywords) ? ins.keywords : [], date });
        if (fresh.length >= 5) break;
      }
      if (!fresh.length) return;

      await this.prisma.memory.createMany({
        data: fresh.map((m) => ({
          personaId,
          text: m.text,
          keywords: JSON.stringify(m.keywords ?? []),
          date,
          importance: 8, // beliefs are high-value for retrieval
          kind: 'reflection',
          source: 'reflection',
        })),
      });
      this.logger.log(`reflection: +${fresh.length} beliefs for persona ${personaId}`);
      void this.backfillEmbeddings(personaId).catch(() => undefined);
    } catch (e) {
      this.logger.warn(`reflection failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async reflectExtract(personaAuthor: string, memTexts: string[]): Promise<MemoryItem[]> {
    const items = await completeJson<MemoryItem[]>({
      model: EXTRACT_MODEL,
      maxTokens: 700,
      messages: [
        {
          role: 'system',
          content:
            'You are a reflective memory system. From a list of memories about ONE person, infer up to 5 higher-level, durable INSIGHTS about who they are: personality patterns, how they relate to others, recurring feelings or themes. Every insight MUST be supported by the memories — never invent. Write from the person\'s point of view, in the dominant language of the memories. Return ONLY a valid JSON array.',
        },
        {
          role: 'user',
          content: `Memories about "${personaAuthor}":\n${memTexts.map((t) => `- ${t}`).join('\n')}\n\nReturn up to 5 insights as JSON:\n[{"text": "one durable insight about ${personaAuthor}", "keywords": ["3-6 lowercase keywords"]}]`,
        },
      ],
    });
    return Array.isArray(items) ? items : [];
  }

  /**
   * Lazily embed any of this persona's memories that lack an embedding (Phase 3
   * Generative-Agents retrieval). Best-effort + bounded per call so it never
   * blocks a chat turn and never floods the embeddings API. No-op without a key.
   * Returns the number of rows embedded.
   */
  async backfillEmbeddings(personaId: string, max = 16): Promise<number> {
    if (!hasEmbedKey()) return 0;
    const rows = await this.prisma.memory.findMany({
      where: { personaId, embedding: null },
      orderBy: { id: 'desc' },
      take: max,
      select: { id: true, text: true },
    });
    if (!rows.length) return 0;
    let n = 0;
    for (const row of rows) {
      try {
        const vec = await embedText(row.text);
        await this.prisma.memory.update({
          where: { id: row.id },
          data: { embedding: serializeEmbedding(vec) },
        });
        n++;
      } catch (e) {
        // Stop on the first transport failure (rate-limit / outage) — retry later.
        this.logger.warn(`embed backfill stopped: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
    if (n) this.logger.log(`embed backfill: +${n} for persona ${personaId}`);
    return n;
  }

  /**
   * Embed the query and bump lastAccessedAt on the retrieved rows. Returns the
   * query embedding (or null when embeddings are unavailable) so the caller can
   * pass it to retrieveMemories for the cosine relevance term. NEVER throws — on
   * any failure it returns null and the caller falls back to the keyword matcher.
   */
  async embedQuery(query: string): Promise<number[] | null> {
    if (!hasEmbedKey()) return null;
    const q = (query ?? '').trim();
    if (!q) return null;
    try {
      return await embedText(q);
    } catch (e) {
      this.logger.warn(`embed query failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** Bump lastAccessedAt on the given memory ids (recency term). Fire-and-forget. */
  async touchAccessed(ids: string[]): Promise<void> {
    const real = ids.filter(Boolean);
    if (!real.length) return;
    await this.prisma.memory
      .updateMany({ where: { id: { in: real } }, data: { lastAccessedAt: new Date() } })
      .catch(() => undefined);
  }

  /**
   * Extract durable memories from ONLY the human's turn (ground truth). The
   * persona's reply is deliberately not passed in (see learnFromTurn / R3) so the
   * model can never "remember" something it just invented. Same shape as
   * engine/extractMemories: [{text, keywords, date}], 0-3 items.
   */
  private async extract(
    personaAuthor: string,
    userAuthor: string,
    userText: string,
  ): Promise<MemoryItem[]> {
    const items = await completeJson<MemoryItem[]>({
      model: EXTRACT_MODEL,
      maxTokens: 700,
      messages: [
        {
          role: 'system',
          content:
            'You extract durable memories for a persona\'s memory system from ONE message the user sent. Capture only things the USER actually revealed and that are worth remembering long-term: events, plans, people, places, the user\'s feelings, conflicts, promises, newly revealed shared facts. Do NOT invent or infer anything not stated. Skip greetings and small talk — if nothing is worth keeping, return []. Write each memory in the dominant language of the message. Return ONLY a valid JSON array.',
        },
        {
          role: 'user',
          content: `"${userAuthor}" just sent this message to "${personaAuthor}". Extract 0-3 NEW durable memories about ${userAuthor} or their shared world, written from ${personaAuthor}'s point of view (return [] for pure small talk):
[{"text": "one self-contained sentence", "keywords": ["3-6 lowercase keywords"], "date": "YYYY-MM"}]

${userAuthor}: ${userText || '(no text)'}`,
        },
      ],
    });
    return Array.isArray(items) ? items : [];
  }
}

function normKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, DEDUPE_PREFIX);
}
