import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Persona } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { StorageService } from './storage.service';
import type { Msg } from '../engine/types';
import { parseTelegramString } from '../engine/parsers/telegram';
import { parseWhatsAppString } from '../engine/parsers/whatsapp';
import { parseInstagramString } from '../engine/parsers/instagram';
import { parseFacebookString } from '../engine/parsers/facebook';
import { parseLineString } from '../engine/parsers/line';
import { parseVkString } from '../engine/parsers/vk';
import { segment } from '../engine/segment';
import { computeStats } from '../engine/stats';
import type { CreatePersonaDto, EnrichPersonaDto, IngestDto, UpdatePersonaDto } from './dto';
import type { PersonaCard } from '../engine/types';
import { PersonaStateService } from './persona-state.service';
import type { Presence as StatePresence } from './presence';

type Source = 'telegram' | 'whatsapp' | 'instagram' | 'facebook' | 'line' | 'vk';

// Positioning gate: 'reconnect' clones a LIVING, non-consenting person (GDPR
// living-data-subject, publicity rights, platform impersonation, processor
// adjacency). Ship memorial-only — the engine still understands both modes, but
// a new 'reconnect' persona can only be created when this flag is explicitly on.
// Default OFF. The frontend hides the option (NEXT_PUBLIC_ALLOW_RECONNECT); this
// is the backend defense-in-depth so a stale/direct client can't bypass it.
const ALLOW_RECONNECT = process.env.ALLOW_RECONNECT === 'true';

const PARSERS: Record<Source, (content: string) => Msg[]> = {
  telegram: parseTelegramString,
  whatsapp: parseWhatsAppString,
  instagram: parseInstagramString,
  facebook: parseFacebookString,
  line: parseLineString,
  vk: parseVkString,
};

export function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type Presence = { state: 'online' } | { state: 'last_seen'; label: string };

/** FNV-1a 32-bit — cheap deterministic hash for presence simulation. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Simulated presence: deterministic per persona per 15-minute window
 * (no DB writes). ~22% of slots are "online"; otherwise a plausible
 * "last seen …" label derived from the same hash. Only for ready personas.
 */
function presenceFor(p: Persona, now: Date = new Date()): Presence | null {
  if (p.status !== 'ready') return null;
  const slot = Math.floor(now.getTime() / (15 * 60 * 1000));
  const h = fnv1a(`${p.id}:${slot}`);
  if (h % 100 < 22) return { state: 'online' };

  const bucket = (h >>> 7) % 100;
  if (bucket >= 88) return { state: 'last_seen', label: 'last seen yesterday' };
  if (bucket >= 55) {
    // 1–6 hours back
    const hours = 1 + ((h >>> 15) % 6);
    return {
      state: 'last_seen',
      label: `last seen ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`,
    };
  }
  // 3–59 minutes back
  const minutes = 3 + ((h >>> 15) % 57);
  return { state: 'last_seen', label: `last seen ${minutes} minutes ago` };
}

function personaView(p: Persona): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    relationship: p.relationship,
    mode: p.mode,
    description: p.description,
    ambient: parseJson<string[]>(p.ambient) ?? [],
    status: p.status,
    presence: presenceFor(p),
    stage: p.stage,
    avatarFile: p.avatarFile,
    demo: p.demo,
    personaAuthor: p.personaAuthor,
    userAuthor: p.userAuthor,
    voiceGender: p.voiceGender,
    voiceId: p.voiceId,
    hasVoiceSample: Boolean(p.voiceSampleFile),
    createdAt: p.createdAt,
  };
}

@Injectable()
export class PersonasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly personaState: PersonaStateService,
  ) {}

  /**
   * Phase 2 presence: energy + agenda derived (online/idle/busy/asleep/last_seen),
   * read-only (no optimistic-lock write). Falls back to the legacy hash presence
   * if the state read fails. Only meaningful for ready personas.
   */
  private async richPresence(p: Persona): Promise<StatePresence | { state: 'online' } | { state: 'last_seen'; label: string } | null> {
    if (p.status !== 'ready') return null;
    try {
      const presence = await this.personaState.presenceOnly(p);
      if (presence) return presence;
    } catch {
      // fall through to the legacy hash presence below
    }
    return presenceFor(p);
  }

  /** Compute rich presence for many personas in parallel (used by list()). */
  private async presenceMap(personas: Persona[]): Promise<Record<string, StatePresence | { state: 'online' } | { state: 'last_seen'; label: string } | null>> {
    const out: Record<string, StatePresence | { state: 'online' } | { state: 'last_seen'; label: string } | null> = {};
    await Promise.all(
      personas.map(async (p) => {
        out[p.id] = await this.richPresence(p);
      }),
    );
    return out;
  }

  async getOwned(userId: string, personaId: string): Promise<Persona> {
    const persona = await this.prisma.persona.findFirst({ where: { id: personaId, userId } });
    if (!persona) throw new NotFoundException('Persona not found');
    return persona;
  }

  async list(userId: string): Promise<Record<string, unknown>[]> {
    const personas = await this.prisma.persona.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { photos: true } } },
    });
    const [meta, presence] = await Promise.all([
      this.unreadAndLast(personas.map((p) => p.id)),
      this.presenceMap(personas),
    ]);
    return personas.map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      mode: p.mode,
      ambient: parseJson<string[]>(p.ambient) ?? [],
      status: p.status,
      presence: presence[p.id] ?? null,
      avatarFile: p.avatarFile,
      demo: p.demo,
      photoCount: p._count.photos,
      unread: meta[p.id]?.unread ?? 0,
      lastMessage: meta[p.id]?.lastMessage ?? null,
      createdAt: p.createdAt,
    }));
  }

  /** Per-persona unread count + last message — lightweight, used by list() and inbox(). */
  private async unreadAndLast(
    personaIds: string[],
  ): Promise<Record<string, { unread: number; lastMessage: { content: string; kind: string; createdAt: Date } | null }>> {
    const out: Record<string, { unread: number; lastMessage: { content: string; kind: string; createdAt: Date } | null }> = {};
    if (!personaIds.length) return out;

    const grouped = await this.prisma.chatMessage.groupBy({
      by: ['personaId'],
      where: { personaId: { in: personaIds }, role: 'assistant', proactive: true, readAt: null },
      _count: { _all: true },
    });
    const unreadByPersona = new Map(grouped.map((g) => [g.personaId, g._count._all]));

    const lasts = await Promise.all(
      personaIds.map((id) =>
        this.prisma.chatMessage.findFirst({
          where: { personaId: id },
          orderBy: { createdAt: 'desc' },
          select: { content: true, kind: true, transcript: true, createdAt: true },
        }),
      ),
    );
    personaIds.forEach((id, i) => {
      const lm = lasts[i];
      out[id] = {
        unread: unreadByPersona.get(id) ?? 0,
        lastMessage: lm
          ? { content: lm.content || lm.transcript || '', kind: lm.kind, createdAt: lm.createdAt }
          : null,
      };
    });
    return out;
  }

  async markRead(userId: string, personaId: string): Promise<{ ok: true; cleared: number }> {
    await this.getOwned(userId, personaId);
    const r = await this.prisma.chatMessage.updateMany({
      where: { personaId, role: 'assistant', proactive: true, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, cleared: r.count };
  }

  async inbox(userId: string): Promise<{
    personas: { id: string; name: string; unread: number; lastMessage: unknown; avatarFile: string | null }[];
    totalUnread: number;
  }> {
    const personas = await this.prisma.persona.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, avatarFile: true },
    });
    const meta = await this.unreadAndLast(personas.map((p) => p.id));
    let totalUnread = 0;
    const rows = personas.map((p) => {
      const unread = meta[p.id]?.unread ?? 0;
      totalUnread += unread;
      return {
        id: p.id,
        name: p.name,
        unread,
        lastMessage: meta[p.id]?.lastMessage ?? null,
        avatarFile: p.avatarFile,
      };
    });
    return { personas: rows, totalUnread };
  }

  async create(userId: string, dto: CreatePersonaDto): Promise<Record<string, unknown>> {
    // Coerce to memorial unless reconnect is explicitly enabled (see ALLOW_RECONNECT).
    const mode = dto.mode === 'reconnect' && !ALLOW_RECONNECT ? 'memorial' : dto.mode;
    const persona = await this.prisma.persona.create({
      data: {
        userId,
        name: dto.name,
        relationship: dto.relationship,
        mode,
        description: dto.description ?? null,
        ambient: dto.ambient ? JSON.stringify(dto.ambient) : null,
        knowledgeCutoff: dto.knowledgeCutoff ?? null,
        status: 'draft',
      },
    });
    return personaView(persona);
  }

  async detail(userId: string, personaId: string): Promise<Record<string, unknown>> {
    const persona = await this.getOwned(userId, personaId);
    const [memoriesCount, recentMemoryRows, photos] = await Promise.all([
      this.prisma.memory.count({ where: { personaId } }),
      // Newest-first. Memory has no createdAt; cuid ids are monotonic by
      // creation time, so id desc gives reverse-chronological order.
      this.prisma.memory.findMany({
        where: { personaId },
        orderBy: { id: 'desc' },
        take: 5,
        select: { text: true, date: true },
      }),
      this.prisma.photo.findMany({
        where: { personaId },
        orderBy: { createdAt: 'asc' },
        select: { file: true, kind: true },
      }),
    ]);
    const recentMemories = recentMemoryRows.map((m) => ({ text: m.text, date: m.date }));
    // Visual-import: while extracted-but-not-yet-confirmed, surface the two
    // derived authors (+ approximate flag) so the frontend can show the
    // "which one is you?" picker. Cleared once confirm() writes the corpus.
    const pending = await this.storage.readPending(personaId);
    const importAuthors = pending?.importAuthors ?? null;
    const presence = await this.richPresence(persona);
    return {
      ...personaView(persona),
      presence,
      stats: parseJson(persona.stats),
      card: parseJson(persona.card),
      memoriesCount,
      recentMemories,
      photos,
      // Phase 1: signal the UI to show the Character Studio (without dumping the
      // whole passport on the detail/list endpoints — the Studio GETs /profile).
      hasPassport: Boolean(persona.passport),
      passportVersion: persona.passportVersion,
      timezone: persona.timezone,
      ...(importAuthors ? { importAuthors, approximate: pending?.approximate ?? true } : {}),
    };
  }

  async update(userId: string, personaId: string, dto: UpdatePersonaDto): Promise<Record<string, unknown>> {
    await this.getOwned(userId, personaId);
    const persona = await this.prisma.persona.update({
      where: { id: personaId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.ambient !== undefined ? { ambient: JSON.stringify(dto.ambient) } : {}),
        ...(dto.knowledgeCutoff !== undefined ? { knowledgeCutoff: dto.knowledgeCutoff } : {}),
      },
    });
    return personaView(persona);
  }

  /**
   * Onboarding enrichment (N10): merge user-described details into the persona —
   * extra pet-names / signature phrases / "they would never" guardrails / traits
   * into the card, episodic anchors as pinned high-importance memories, and the
   * knowledge-cutoff date. Everything the deterministic build can't infer from the
   * chat alone but a person who knew them can supply.
   */
  async enrich(userId: string, personaId: string, dto: EnrichPersonaDto): Promise<Record<string, unknown>> {
    await this.getOwned(userId, personaId);
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });

    const merge = (existing: string[] | undefined, incoming: string[] | undefined, cap: number): string[] => {
      const set = new Set<string>(existing ?? []);
      for (const s of incoming ?? []) {
        const t = s.trim();
        if (t) set.add(t);
      }
      return [...set].slice(0, cap);
    };

    const card = persona?.card ? parseJson<PersonaCard>(persona.card) : null;
    if (card) {
      if (dto.petNames) card.pet_names = merge(card.pet_names, dto.petNames, 30);
      if (dto.signaturePhrases) card.signature_phrases = merge(card.signature_phrases, dto.signaturePhrases, 24);
      if (dto.neverSay) card.never_say = merge(card.never_say, dto.neverSay, 20);
      if (dto.traits) card.traits = merge(card.traits, dto.traits, 20);
    }

    // Episodic anchors → pinned (kind='fact'), top-importance, source='user' so
    // they're always-resident in the prompt and never gated out by retrieval.
    const anchors = (dto.anchors ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 20);
    if (anchors.length) {
      const now = new Date();
      const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      await this.prisma.memory.createMany({
        data: anchors.map((text) => ({
          personaId,
          text,
          keywords: JSON.stringify([]),
          date,
          importance: 10,
          kind: 'fact',
          source: 'user',
        })),
      });
    }

    const persisted = await this.prisma.persona.update({
      where: { id: personaId },
      data: {
        ...(card ? { card: JSON.stringify(card) } : {}),
        ...(dto.knowledgeCutoff !== undefined ? { knowledgeCutoff: dto.knowledgeCutoff } : {}),
      },
    });
    return personaView(persisted);
  }

  async remove(userId: string, personaId: string): Promise<{ ok: true }> {
    await this.getOwned(userId, personaId);
    await this.prisma.persona.delete({ where: { id: personaId } });
    await this.storage.deletePersonaFiles(personaId);
    return { ok: true };
  }

  async ingest(userId: string, personaId: string, dto: IngestDto): Promise<Record<string, unknown>> {
    const persona = await this.getOwned(userId, personaId);

    let source: Source;
    let content: string;
    let me = dto.me;

    if (dto.demo) {
      source = 'telegram';
      me = 'Alex';
      try {
        content = await readFile(path.join(process.cwd(), 'fixtures', 'sample-telegram.json'), 'utf8');
      } catch {
        throw new BadRequestException('Demo data unavailable');
      }
    } else {
      if (!dto.source || !(dto.source in PARSERS) || typeof dto.content !== 'string') {
        throw new BadRequestException('source and content are required');
      }
      source = dto.source;
      content = dto.content;
    }

    let messages: Msg[];
    try {
      messages = PARSERS[source](content);
    } catch {
      throw new UnprocessableEntityException('Could not read the file — check that it is the right export');
    }
    if (!messages.length) {
      throw new UnprocessableEntityException('No messages found in the file');
    }

    const counts = new Map<string, number>();
    for (const m of messages) counts.set(m.author, (counts.get(m.author) ?? 0) + 1);
    const authors = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    if (!me || !counts.has(me)) {
      return { authors };
    }

    const conversations = segment(messages, 12);
    const kept = conversations.flatMap((c) => c.messages);
    if (!kept.length) {
      throw new UnprocessableEntityException('Too few messages within the last year');
    }
    const stats = computeStats(kept);

    const personaAuthor = authors.find((a) => a.name !== me)?.name;
    if (!personaAuthor) {
      throw new UnprocessableEntityException('The chat has only one participant — a dialogue is needed');
    }

    await this.storage.writeCorpus(persona.id, {
      source,
      personaAuthor,
      userAuthor: me,
      conversations,
      stats,
    });

    await this.prisma.persona.update({
      where: { id: persona.id },
      data: {
        stats: JSON.stringify(stats),
        personaAuthor,
        userAuthor: me,
        status: 'ingested',
        stage: null,
      },
    });

    return { stats, personaAuthor, userAuthor: me, conversations: conversations.length };
  }
}
