import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Persona } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PersonasService, parseJson } from './personas.service';
import type { CorpusStats, MemoryItem, PersonaCard, PersonaFile } from '../engine/types';
import { CHAT_MODEL, complete, hasApiKey } from '../engine/llm';
import { cleanReply } from '../engine/sanitize';
import { buildSystemPrompt } from '../engine/prompt';
import { parsePassport } from '../engine/passport';
import { isQuietHour, scheduleNextNudge } from './chat.service';
import { PushService } from '../push/push.service';
import { PersonaStateService } from './persona-state.service';
import { AgendaService } from './agenda.service';
import { shouldTextFirst, baseGapHours, type ProactiveGateInput } from './proactive-gate';
import { mulberry32, fnv1a, systemClock } from '../engine/state';

const MAX_CONSECUTIVE_PROACTIVE = 3;
const PUSH_BODY_MAX = 80;
// Hard per-tick ceiling on proactive LLM generations (cost guardrail). Each due
// persona can cost one CHAT_MODEL call per tick; cap the batch so a large ready
// population can't fan out into an unbounded per-minute spend. Env-tunable.
const NUDGE_BATCH = Math.max(1, Number(process.env.NUDGE_BATCH) || 12);

const NUDGE_INSTRUCTION = `Right now YOU are texting ${'{user}'} first — they have not written for a while and you feel like reaching out. Write ONE short, natural, unprompted message in your exact texting style (you may add a second very short line). Be context-aware: if it has been a long time, a gentle "як ти там? щось зник" in YOUR voice; otherwise just share a thought, a small thing from your day, or ask how they are. NEVER guilt them for not writing, never sound needy, hurt, jealous or accusatory ("чому ти мовчиш", "ти мене забув", "знову ігноруєш") — keep it warm and light, the kind of message that's nice to receive. Vary the tone, never sound like a template. Output ONLY the literal message text, no narration, no marker tags.`;

@Injectable()
export class ProactiveService {
  private readonly logger = new Logger(ProactiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly personas: PersonasService,
    private readonly push: PushService,
    private readonly state: PersonaStateService,
    private readonly agenda: AgendaService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    const now = new Date();
    // Quiet hours: don't fire nudges at night. Schedules stay intact — they'll
    // fire once the quiet window ends (and scheduleNextNudge avoids re-landing in it).
    if (isQuietHour(now)) return;
    let due: Persona[];
    try {
      due = await this.prisma.persona.findMany({
        where: { status: 'ready', nextNudgeAt: { not: null, lte: now } },
        orderBy: { nextNudgeAt: 'asc' },
        take: NUDGE_BATCH,
      });
    } catch (e) {
      this.logger.warn(`nudge tick query failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    for (const persona of due) {
      try {
        await this.maybeNudge(persona);
      } catch (e) {
        this.logger.warn(`nudge failed for ${persona.id}: ${e instanceof Error ? e.message : String(e)}`);
        // back off so a broken persona doesn't spin every minute
        await this.prisma.persona
          .update({ where: { id: persona.id }, data: { nextNudgeAt: scheduleNextNudge(new Date()) } })
          .catch(() => undefined);
      }
    }
  }

  /**
   * Scheduled path. Order of authority (design §5/§9):
   *   1. MAX_CONSECUTIVE_PROACTIVE cap (hard — overrides closeness/energy).
   *   2. thin LLM-free state gate shouldTextFirst() (asleep/paused/memorial/
   *      energy/busy/silence + Poisson coin), HUMAN-paced base gap.
   * Closeness only tunes WITHIN the cap, never overrides it.
   */
  private async maybeNudge(persona: Persona): Promise<void> {
    const last = await this.prisma.chatMessage.findFirst({
      where: { personaId: persona.id },
      orderBy: { createdAt: 'desc' },
    });
    // Don't double-nudge: if the last message is already an unanswered proactive one, count consecutive.
    const unreadProactive = await this.prisma.chatMessage.count({
      where: { personaId: persona.id, role: 'assistant', proactive: true, readAt: null },
    });
    if (last && last.role === 'assistant' && last.proactive) {
      if (unreadProactive >= MAX_CONSECUTIVE_PROACTIVE) {
        // Cap reached: stop nudging until the user replies (clear the schedule).
        await this.prisma.persona.update({ where: { id: persona.id }, data: { nextNudgeAt: null } });
        return;
      }
    }

    // Live state gate. Read the snapshot (compute-on-read) and decide.
    const snap = await this.state.read(persona.id).catch(() => null);
    const passport = parsePassport(persona.passport);
    const silenceHours = persona.lastUserAt
      ? Math.max(0, (Date.now() - persona.lastUserAt.getTime()) / 3_600_000)
      : 999;
    const gateInput: ProactiveGateInput = {
      closeness: snap?.closeness ?? passport?.relationship.closenessSeed ?? 40,
      stage: snap?.stage ?? 1,
      energy: snap?.energy ?? 0.6,
      asleep: snap?.presence?.state === 'asleep' || Boolean(snap?.asleep),
      busy: snap?.currentActivity?.busy ?? false,
      silenceHours,
      proactivityScale: passport?.relationship.proactivityScale ?? 1.0,
      paused: passport?.boundaries.paused ?? false,
      memorial: (passport?.mode ?? persona.mode) === 'memorial',
    };
    const rng = mulberry32(fnv1a(`${persona.id}:nudge:${Math.floor(Date.now() / 60000)}`));
    const decision = shouldTextFirst(gateInput, rng);
    const gap = decision.baseGapHours;

    if (!decision.send) {
      // Hold: push the next check out by the human-paced gap (never minutes).
      await this.prisma.persona.update({
        where: { id: persona.id },
        data: { nextNudgeAt: this.humanPacedNext(gap) },
      });
      return;
    }

    await this.generateAndSave(persona, snap?.currentActivity?.label ?? null);
    await this.prisma.persona.update({
      where: { id: persona.id },
      data: { nextNudgeAt: this.humanPacedNext(gap) },
    });
  }

  /** Next nudge ~baseGapHours out (jittered ±20%), pushed out of quiet hours. */
  private humanPacedNext(gapHours: number): Date {
    const jitter = 0.8 + Math.random() * 0.4; // ±20%
    const ms = Math.max(1, gapHours * jitter) * 3_600_000;
    return scheduleNextNudge(new Date(Date.now() + ms - 40 * 60_000));
    // (scheduleNextNudge re-applies a small random offset + quiet-hours avoidance;
    //  we pre-offset by ~the gap so the human cadence dominates the legacy 20-90min.)
  }

  /** Dev/testing: force one proactive message now, ignoring the schedule + cap. */
  async nudgeNow(userId: string, personaId: string): Promise<Record<string, unknown>> {
    const persona = await this.personas.getOwned(userId, personaId);
    const snap = await this.state.read(personaId).catch(() => null);
    const msg = await this.generateAndSave(persona, snap?.currentActivity?.label ?? null);
    const gap = baseGapHours(
      snap?.closeness ?? 40,
      parsePassport(persona.passport)?.relationship.proactivityScale ?? 1.0,
    );
    await this.prisma.persona.update({
      where: { id: personaId },
      data: { nextNudgeAt: this.humanPacedNext(gap) },
    });
    return msg;
  }

  private async generateAndSave(persona: Persona, activityLabel: string | null): Promise<Record<string, unknown>> {
    const text = await this.generateText(persona, activityLabel);
    const created = await this.prisma.chatMessage.create({
      data: { personaId: persona.id, role: 'assistant', kind: 'text', content: text, proactive: true },
    });
    await this.prisma.persona.update({
      where: { id: persona.id },
      data: { lastPersonaAt: new Date() },
    });
    // Fire-and-forget: reach the user even when the app is closed. Never blocks the cron.
    const body = text.length > PUSH_BODY_MAX ? `${text.slice(0, PUSH_BODY_MAX - 1).trimEnd()}…` : text;
    void this.push
      .sendToUser(persona.userId, {
        title: persona.name,
        body,
        url: `/chat?id=${persona.id}`,
      })
      .then((sent) => this.logger.log(`proactive push -> sendToUser(${persona.userId}) sent=${sent}`))
      .catch(() => undefined);
    return {
      id: created.id,
      role: created.role,
      content: created.content,
      kind: created.kind,
      proactive: created.proactive,
      readAt: created.readAt,
      createdAt: created.createdAt,
    };
  }

  private async generateText(persona: Persona, activityLabel: string | null): Promise<string> {
    const personaFile = this.tryLoad(persona);
    if (hasApiKey() && personaFile) {
      // Read the SAME live snapshot the gate used so the opener's tone/activity
      // agree with presence (never "I miss you, why aren't you talking to me").
      let live: ReturnType<PersonaStateService['toLiveState']> | undefined;
      try {
        const snap = await this.state.read(persona.id, { clock: systemClock });
        if (snap) live = this.state.toLiveState(snap);
      } catch {
        // fall through with no live block
      }
      // Proactive nudges are always text — never a voice note.
      const system = buildSystemPrompt(personaFile, personaFile.memories.slice(-5), new Date(), {
        voiceEnabled: false,
        ...(live ? { live } : {}),
      });
      const anchor = activityLabel
        ? ` You just got back from / finished ${activityLabel} — you may anchor the opener to that, naturally.`
        : '';
      const instr = NUDGE_INSTRUCTION.replace('{user}', personaFile.userAuthor) + anchor;
      try {
        const raw = await complete({
          model: CHAT_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: instr },
          ],
          temperature: 0.95,
          maxTokens: 120,
        });
        const text = cleanReply(raw.replace(/\[\[SELFIE:[^\]]*\]\]/gi, ''));
        if (text) return text;
      } catch (e) {
        this.logger.warn(`nudge generate failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Stub / fallback: a real exemplar line or a gentle default.
    if (personaFile) {
      const line = pickExemplarLine(personaFile);
      if (line) return line;
    }
    return 'як ти там? щось зник)';
  }

  private tryLoad(persona: Persona): PersonaFile | null {
    const card = parseJson<PersonaCard>(persona.card);
    const stats = parseJson<CorpusStats>(persona.stats);
    const exemplars = parseJson<string[]>(persona.exemplars) ?? [];
    if (!card || !stats || !persona.personaAuthor || !persona.userAuthor) return null;
    const memories: MemoryItem[] = [];
    const passport = parsePassport(persona.passport);
    return {
      builtAt: persona.createdAt.toISOString(),
      source: 'db',
      personaAuthor: persona.personaAuthor,
      userAuthor: persona.userAuthor,
      card,
      exemplars,
      memories,
      stats,
      ...(passport ? { passport } : {}),
      ...(persona.knowledgeCutoff ? { knowledgeCutoff: persona.knowledgeCutoff } : {}),
    };
  }
}

function pickExemplarLine(persona: PersonaFile): string | null {
  const prefix = `${persona.personaAuthor}: `;
  const lines: string[] = [];
  for (const ex of persona.exemplars) {
    for (const line of ex.split('\n')) {
      if (!line.startsWith(prefix)) continue;
      const text = line.slice(prefix.length).trim();
      if (text.length < 3 || text.startsWith('[')) continue;
      lines.push(text);
    }
  }
  if (!lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}
