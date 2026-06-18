import { BadRequestException, ConflictException, Injectable, Logger, NotImplementedException } from '@nestjs/common';
import type { Response } from 'express';
import type { Persona } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PersonasService, parseJson } from './personas.service';
import { StorageService } from './storage.service';
import { SelfieService } from './selfie.service';
import { MemoryService } from './memory.service';
import type { CorpusStats, MemoryItem, PersonaCard, PersonaFile } from '../engine/types';
import type { ChatMessage as LlmMessage } from '../engine/llm';
import { CHAT_MODEL, hasApiKey, streamChat } from '../engine/llm';
import { buildSystemPrompt, retrieveMemories } from '../engine/prompt';
import { parsePassport } from '../engine/passport';
import { PersonaStateService, type AffectInput, type StateSnapshot } from './persona-state.service';
import { AgendaService } from './agenda.service';
import { classifyExchange } from './appraisal';
import { systemClock, dayRng, localDateStr } from '../engine/state';
import { cleanReply } from '../engine/sanitize';
import { parseEmbedding } from '../engine/embeddings';
import {
  classifyMsgType,
  computeBehavior,
  knobsFromPassport,
  selfCorrection,
  type BehaviorState,
  type MsgFeatures,
} from '../engine/behavior';
import { cleanGoodbye, isFarewell } from '../engine/goodbye';
import { captionImage } from '../engine/vision';
import { hasSttKey, SttUnavailableError, transcribeAudio } from '../engine/stt';
import { hasTtsKey, synthesizeSpeech, TtsUnavailableError } from '../engine/tts';

const HISTORY_LIMIT = 30;
const SELFIE_MARKER = /\[\[SELFIE:\s*([^\]]*)\]\]/i;
// Matches the canonical [[VOICE]] marker and the colon-variant the model
// occasionally improvises ([[VOICE: warm, teasing]]) — both must be stripped,
// never leaked, whether or not voice is enabled.
const VOICE_MARKER = /\[\[VOICE(?::[^\]]*)?\]\]/i;

export interface ChatAttachments {
  image?: { buffer: Buffer; mime: string; ext: string };
  audio?: { buffer: Buffer; mime: string; ext: string };
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly personas: PersonasService,
    private readonly storage: StorageService,
    private readonly selfie: SelfieService,
    private readonly memory: MemoryService,
    private readonly state: PersonaStateService,
    private readonly agenda: AgendaService,
  ) {}

  async chat(
    userId: string,
    personaId: string,
    message: string,
    res: Response,
    attachments: ChatAttachments = {},
    mode?: 'call',
  ): Promise<void> {
    const persona = await this.personas.getOwned(userId, personaId);
    if (persona.status !== 'ready') {
      throw new BadRequestException('Persona is not ready yet');
    }

    // Voice replies are allowed ONLY when she has a cloned voice from an
    // uploaded sample (persona.voiceId set) AND a TTS key is configured. No
    // preset-voice replies ever. This drives both rule 9 in the prompt and the
    // actual voice-synthesis trigger below.
    const voiceEnabled = Boolean(persona.voiceId) && hasTtsKey();
    const callMode = mode === 'call';

    // Call mode requires her real cloned voice. Respond BEFORE persisting or
    // opening the SSE stream so the frontend can prompt the user to add it.
    if (callMode && !voiceEnabled) {
      throw new ConflictException({ error: 'voice_required' });
    }

    // Voice path needs a key up front (501 before we open the SSE stream).
    if (attachments.audio && !hasSttKey()) {
      throw new NotImplementedException({ error: 'stt_unavailable' });
    }

    const personaFile = await this.loadPersonaFile(persona);

    // The literal text turn the model sees (may be augmented by photo caption / transcript).
    let turnContent = (message ?? '').trim();
    const userSentVoice = Boolean(attachments.audio);

    // --- Image attachment -> caption + user 'image' message ---
    if (attachments.image) {
      const file = await this.storage.savePhoto(
        personaId,
        `usermsg-${Date.now()}${attachments.image.ext}`,
        attachments.image.buffer,
      );
      await this.prisma.chatMessage.create({
        data: { personaId, role: 'user', kind: 'image', imageFile: file, content: turnContent },
      });
      let caption = '(a photo)';
      try {
        caption = await captionImage(attachments.image.buffer, attachments.image.mime);
      } catch (e) {
        this.logger.warn(`captionImage failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      const userAuthor = personaFile.userAuthor;
      const line = `[${userAuthor} sent a photo: ${caption}]`;
      turnContent = turnContent ? `${turnContent}\n${line}` : line;
    }

    // --- Audio attachment -> transcribe + user 'voice' message ---
    if (attachments.audio) {
      const file = await this.storage.savePhoto(
        personaId,
        `usermsg-${Date.now()}${attachments.audio.ext}`,
        attachments.audio.buffer,
      );
      let transcript = '';
      try {
        transcript = await transcribeAudio(attachments.audio.buffer, attachments.audio.mime);
      } catch (e) {
        if (e instanceof SttUnavailableError) throw new NotImplementedException({ error: 'stt_unavailable' });
        this.logger.error(`transcribeAudio failed: ${e instanceof Error ? e.message : String(e)}`);
        transcript = '';
      }
      await this.prisma.chatMessage.create({
        data: { personaId, role: 'user', kind: 'voice', audioFile: file, transcript, content: transcript },
      });
      turnContent = transcript || turnContent;
    }

    // Plain text message (no attachments) -> persist a normal user turn.
    if (!attachments.image && !attachments.audio) {
      if (!turnContent) throw new BadRequestException('Empty message');
      await this.prisma.chatMessage.create({
        data: { personaId, role: 'user', kind: 'text', content: turnContent },
      });
    }

    // Capture pre-turn context for the appraisal hook BEFORE markUserTurn clears
    // it: gap since last user turn (re-engagement bonus) + whether this reply
    // answers an unread proactive nudge (reciprocity 1.5).
    const gapDays = persona.lastUserAt
      ? Math.max(0, (Date.now() - persona.lastUserAt.getTime()) / 86_400_000)
      : 0;
    const repliedToNudge =
      (await this.prisma.chatMessage.count({
        where: { personaId, role: 'assistant', proactive: true, readAt: null },
      })) > 0;

    // User just spoke: update activity + reschedule nudge + clear unread.
    await this.markUserTurn(personaId);

    // Lazily ensure today's agenda exists (LLM-free clone when possible) so the
    // current-activity lookup is warm for this + subsequent reads. Fire-and-forget.
    void this.agenda.ensureToday(personaId).catch(() => undefined);

    // Compute-on-read the LIVE state ONCE for this request (optimistic-lock write)
    // and feed it into the prompt so presence / tone / activity all agree.
    let live: ReturnType<PersonaStateService['toLiveState']> | undefined;
    let snapshot: StateSnapshot | null = null;
    try {
      const snap = await this.state.read(personaId);
      if (snap) {
        snapshot = snap;
        live = this.state.toLiveState(snap);
      }
    } catch (e) {
      this.logger.warn(`state read failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const recent = await this.prisma.chatMessage.findMany({
      where: { personaId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    const history: LlmMessage[] = recent
      .reverse()
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content || m.transcript || '' }))
      .filter((m) => m.content.length > 0);

    // --- Generative-Agents retrieval (Phase 3): embed the query (best-effort,
    // NEVER blocks — null falls back to the keyword matcher), blend cosine, then
    // bump lastAccessedAt on what we surfaced. Lazy backfill embeds older rows. ---
    const queryEmbedding = await this.memory.embedQuery(turnContent);
    const retrieved = retrieveMemories(
      personaFile,
      turnContent,
      7,
      queryEmbedding ? { queryEmbedding } : {},
    );
    void this.memory.touchAccessed(retrieved.map((m) => m.id).filter((x): x is string => !!x));
    void this.memory.backfillEmbeddings(personaId).catch(() => undefined);

    // --- Behavior layer (Phase 3 §6): pure state-driven micro-behaviors. The
    // seeded day-rng makes a persona-day reproducible/testable. Computed from the
    // live snapshot + passport knobs + the inbound message type. ---
    const emotionalHint = classifyExchange(turnContent, {
      medianWords:
        personaFile.passport?.medianWords ??
        personaFile.stats.byAuthor[personaFile.userAuthor]?.medianWords ??
        6,
      repliedToNudge,
      gapDays,
      modality: userSentVoice ? 'voice' : attachments.image ? 'photo' : 'text',
    }).exchange.depth >= 0.8;
    const msgFeatures: MsgFeatures = classifyMsgType(turnContent, {
      emotionalHint,
      isAck: repliedToNudge,
    });
    const behaviorState = this.behaviorStateFrom(snapshot);
    const knobs = knobsFromPassport(personaFile.passport ?? null, persona.voiceGender);
    const localDate = localDateStr(
      systemClock,
      personaFile.passport?.timezone ?? persona.timezone ?? 'Europe/Kyiv',
    );
    // One rng stream per (persona, day, turn) — turn salt keeps consecutive turns
    // from drawing identical behavior while staying day-reproducible in a test.
    const turnSalt = (await this.prisma.chatMessage.count({ where: { personaId } })) % 100000;
    const rng = dayRng(personaId, `${localDate}:${turnSalt}`);
    const behavior = behaviorState
      ? computeBehavior(behaviorState, knobs, msgFeatures, rng, {})
      : null;

    // --- Clean goodbye intent (Phase 3 §5 ethics): a farewell gets a warm, brief
    // close with NONE of the 6 HBS dark-pattern tactics. We add a soft directive
    // to the prompt; the deterministic cleanGoodbye() is the no-LLM fallback. ---
    const farewell = isFarewell(turnContent);

    let system = buildSystemPrompt(personaFile, retrieved, new Date(), {
      voiceEnabled,
      ...(live ? { live } : {}),
    });
    // Soft reply-length nudge from replyLengthHint (NOT a hard truncate) + the
    // clean-goodbye directive when the user is leaving.
    if (behavior) {
      system += `\n\nFor THIS reply only: keep it around ${behavior.replyLengthHint} words across your bubble(s) — natural, not padded.`;
    }
    if (farewell) {
      system +=
        '\n\nThe other person is saying goodbye. Reply with a warm, brief, genuine close that respects them leaving. Do NOT guilt them, do NOT say "don\'t go" or "stay", do NOT create FOMO or re-ask if they\'re sure, do NOT act needy or jealous. One short line is enough.';
    }
    // One-shot debug: confirm the assembled prompt carries the passport-driven
    // state block (guard + register + baseline hint). Gate behind DEBUG_PROMPT so
    // it never floods normal logs; read at call-time.
    if (process.env.DEBUG_PROMPT === '1') {
      const idx = system.indexOf('## Your current state');
      this.logger.log(`[DEBUG_PROMPT] system tail:\n${idx >= 0 ? system.slice(idx) : '(no state block)'}`);
    }
    // Call mode: append a one-turn brevity instruction (NOT persisted into the
    // persona) so spoken replies stay short and natural.
    if (callMode) {
      system +=
        '\n\nYou are on a quick VOICE CALL — reply in 1-2 short spoken sentences, natural and warm, no long monologues, no lists, no markers.';
    }
    const messages: LlmMessage[] = [{ role: 'system', content: system }, ...history];

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // EARLY behavior event (Phase 3 §6): the client's pacing.ts consumes these
    // state-driven values (read delay, per-bubble typing, inter-bubble gaps,
    // bubble count) INSTEAD of its hardcoded defaults. Emitted before the first
    // token so pacing is right from the start. 'seen'/typing-stop are gated by
    // seenPolicy (stage<3 + close-only knob -> no 'seen', anti left-on-read).
    if (behavior && !callMode) {
      res.write(
        `data: ${JSON.stringify({
          behavior: {
            readDelayMs: behavior.readDelayMs,
            perBubbleTyping: behavior.perBubbleTyping,
            gapMs: behavior.gapMs,
            bubbleCount: behavior.bubbleCount,
            busyOverride: behavior.busyOverride,
            showSeen: behavior.seen.showSeen,
            typingThenStop: behavior.seen.typingThenStop,
          },
        })}\n\n`,
      );
    }

    // EMOJI-ONLY REACTION (Phase 3 §6.4): when the emoji-only coin fires on a
    // banter/ack turn, she taps back a single emoji INSTEAD of a text reply (a
    // tapback, not a bubble). FORCED off on emotional / question turns (handled
    // in emojiPolicy) and never on a farewell or a call. Short-circuits the LLM.
    if (behavior && !callMode && !farewell && !attachments.audio && !attachments.image) {
      const fire = rng() < behavior.emoji.pEmojiOnlyReaction;
      if (fire) {
        const emoji = pickReactionEmoji(personaFile);
        res.write(`data: ${JSON.stringify({ reaction: emoji })}\n\n`);
        await this.prisma.chatMessage
          .create({ data: { personaId, role: 'assistant', kind: 'text', content: emoji } })
          .catch(() => undefined);
        await this.prisma.persona
          .update({ where: { id: personaId }, data: { lastPersonaAt: new Date() } })
          .catch(() => undefined);
        // Still run the appraisal hook below would double-read; keep it simple:
        // a tapback is low-effort, so skip closeness gain and just close the stream.
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    // Marker stripping: buffer a small tail so a marker ([[SELFIE: …]] or
    // [[VOICE]]) split across tokens is never leaked to the client.
    let pending = '';
    let visibleFull = '';
    let selfieHint: string | null = null;
    let voiceRequested = false;

    const emitVisible = (chunk: string) => {
      if (chunk) {
        visibleFull += chunk;
        res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
      }
    };

    const handle = (tok: string) => {
      if (selfieHint !== null) return; // already captured a selfie marker this reply
      pending += tok;
      // Voice marker: drop it from visible text wherever it appears (own line).
      const v = pending.match(VOICE_MARKER);
      if (v) {
        voiceRequested = true;
        // Strip the marker (and a lone surrounding newline) from the buffer.
        pending = pending.replace(VOICE_MARKER, '').replace(/\n{2,}/g, '\n');
      }
      const m = pending.match(SELFIE_MARKER);
      if (m) {
        selfieHint = (m[1] ?? '').trim();
        emitVisible(pending.slice(0, m.index));
        pending = ''; // drop everything from the marker onward
        return;
      }
      // An opened (still unclosed) marker: emit text before it, hold the rest.
      const open = openMarkerIndex(pending);
      if (open >= 0) {
        if (open > 0) {
          emitVisible(pending.slice(0, open));
          pending = pending.slice(open);
        }
        return; // wait for the closing marker
      }
      // Hold back a tail that could be the start of a marker.
      const keep = tailToHold(pending);
      if (keep < pending.length) {
        emitVisible(pending.slice(0, pending.length - keep));
        pending = pending.slice(pending.length - keep);
      }
    };

    try {
      if (hasApiKey()) {
        await streamChat(
          { model: CHAT_MODEL, messages, ...(callMode ? { maxTokens: 160 } : {}) },
          handle,
        );
      } else if (farewell) {
        // No-LLM fallback for a goodbye: a deterministic CLEAN close (none of the
        // 6 HBS dark-pattern tactics — snapshot-tested in goodbye.test.ts). Night
        // close when she'd plausibly be winding down (asleep/low energy).
        const night = Boolean(behaviorState?.asleep) || (behaviorState?.energy ?? 1) < 0.3;
        const englishCorpus = /en/i.test(personaFile.passport?.locale ?? '');
        handle(cleanGoodbye({ night, english: englishCorpus, pick: rng() }) + '\n');
      } else {
        for (const line of cannedReply(personaFile)) {
          await new Promise((r) => setTimeout(r, 400));
          handle(line + '\n');
        }
      }
      if (selfieHint === null && pending) {
        // Flush any complete VOICE marker still sitting in the tail.
        if (VOICE_MARKER.test(pending)) {
          voiceRequested = true;
          pending = pending.replace(VOICE_MARKER, '').replace(/\n{2,}/g, '\n');
        }
        // Unclosed marker at end of stream: salvage the selfie hint, never leak it.
        const selfieOpen = pending.indexOf('[[SELFIE:');
        // An opened-but-unclosed voice marker ("[[VOICE" / "[[VOICE: …") OR a
        // dangling partial tail — either way, drop everything from it onward.
        const voiceOpen = pending.search(/\[\[V(?:OICE(?::[^\]]*)?|O?I?C?E?)?$|\[\[VOICE:/i);
        if (selfieOpen >= 0) {
          selfieHint = pending.slice(selfieOpen + 9).replace(/\]\]?\s*$/, '').trim();
          if (selfieOpen > 0) emitVisible(pending.slice(0, selfieOpen));
        } else if (voiceOpen >= 0) {
          // Dropped (it's a voice request the persona can't fulfill without a
          // cloned voice, or a partial marker) — never leak the marker text.
          if (voiceOpen > 0) emitVisible(pending.slice(0, voiceOpen));
        } else {
          emitVisible(pending);
        }
        pending = '';
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`chat stream failed: ${msg}`);
      res.write(`data: ${JSON.stringify({ token: `[error: ${msg.slice(0, 120)}]` })}\n\n`);
    }

    // Clean up two recurring model tics before persisting/speaking the text:
    //  - bare "або"/"or"/"чи" divider lines between alternative phrasings;
    //  - asterisk stage-directions (*тихий сміх*) — a whole-line action is dropped,
    //    inline emphasis (*обов'язково*) keeps the word but loses the asterisks.
    const finalText = cleanReply(visibleFull);

    // VISIBLE SELF-CORRECTION (Phase 3 §6.5 — the #1 realism lever): occasionally
    // emit a type->backspace->fix on ONE word of one bubble. The fix lands on the
    // REAL word (we never mutate finalText), so an uncorrected typo can NEVER ship.
    // Render hint only; gated by the seeded rng + typoTendency knob. Not for voice.
    if (behavior && behaviorState && finalText && !voiceRequested && !userSentVoice && !callMode) {
      const bubbles = finalText.split('\n').filter((l) => l.trim().length > 0);
      if (bubbles.length) {
        const idx = Math.floor(rng() * bubbles.length);
        const corr = selfCorrection(behaviorState, knobs, bubbles[idx], idx, rng);
        if (corr) {
          res.write(
            `data: ${JSON.stringify({
              correct: {
                bubbleIndex: corr.bubbleIndex,
                typed: corr.typedPartial,
                backspace: corr.backspaceN,
                fix: corr.finalWord,
              },
            })}\n\n`,
          );
        }
      }
    }

    // Voice reply: triggered by the [[VOICE]] marker OR by the user voice-noting us.
    // Mirrors the selfie SSE event shape. On success we persist ONE voice message
    // carrying the transcript and do NOT also persist the text bubbles (no doubles);
    // on failure we keep the already-streamed text as a normal text message.
    let voiceHandled = false;
    if ((voiceRequested || userSentVoice || callMode) && finalText && voiceEnabled) {
      res.write(`data: ${JSON.stringify({ voice: 'pending' })}\n\n`);
      try {
        const { buffer, ext } = await synthesizeSpeech(finalText, {
          voiceId: persona.voiceId,
          gender: persona.voiceGender,
        });
        const file = await this.storage.saveAudio(personaId, `voice-${Date.now()}${ext}`, buffer);
        await this.prisma.chatMessage.create({
          data: {
            personaId,
            role: 'assistant',
            kind: 'voice',
            audioFile: file,
            transcript: finalText,
            content: finalText,
          },
        });
        res.write(`data: ${JSON.stringify({ voice: file })}\n\n`);
        voiceHandled = true;
      } catch (e) {
        if (e instanceof TtsUnavailableError) {
          this.logger.warn('voice reply skipped: TTS unavailable');
        } else {
          this.logger.warn(`voice reply failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        res.write(`data: ${JSON.stringify({ voice: 'failed' })}\n\n`);
      }
    }

    if (!voiceHandled && finalText) {
      await this.prisma.chatMessage
        .create({ data: { personaId, role: 'assistant', kind: 'text', content: finalText } })
        .catch(() => undefined);
    }
    await this.prisma.persona
      .update({ where: { id: personaId }, data: { lastPersonaAt: new Date() } })
      .catch(() => undefined);

    // Live memory: fire-and-forget extraction of 0-3 new memories from this
    // exchange. NOT awaited — it must never block/delay the SSE response.
    if (finalText) {
      void this.memory.learnFromTurn(
        personaId,
        personaFile.personaAuthor,
        personaFile.userAuthor,
        turnContent,
        finalText,
      );
    }

    // Appraisal hook (design spec §5/§9): classify the exchange depth/reciprocity
    // (lexicon via tokens(), NO per-message LLM), bump closeness + push an emotion,
    // write an AffectEvent audit row. Fire-and-forget — never blocks the response.
    if (turnContent) {
      const ex = classifyExchange(turnContent, {
        medianWords: personaFile.passport?.medianWords ?? personaFile.stats.byAuthor[personaFile.userAuthor]?.medianWords ?? 6,
        repliedToNudge,
        gapDays,
        modality: userSentVoice ? 'voice' : attachments.image ? 'photo' : 'text',
      });
      const affect: AffectInput = {
        kind: repliedToNudge ? 'reengage' : 'user_warm',
        exchange: ex.exchange,
        emotion: ex.emotion,
        importance: ex.importance,
      };
      void this.state.applyEvent(personaId, affect, systemClock).catch((e) =>
        this.logger.warn(`applyEvent failed: ${e instanceof Error ? e.message : String(e)}`),
      );
    }

    // In-chat selfie: marker detected -> generate then emit selfie SSE events.
    // Never in call mode — a voice call never sends a photo (marker ignored;
    // it was already stripped from the visible/spoken text above).
    if (selfieHint !== null && !callMode) {
      res.write(`data: ${JSON.stringify({ selfie: 'pending' })}\n\n`);
      try {
        const { file } = await this.selfie.selfie(userId, personaId, selfieHint || undefined);
        res.write(`data: ${JSON.stringify({ selfie: file })}\n\n`);
      } catch (e) {
        this.logger.warn(`in-chat selfie failed: ${e instanceof Error ? e.message : String(e)}`);
        res.write(`data: ${JSON.stringify({ selfie: 'failed' })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }

  /**
   * Map the full StateSnapshot into the slim BehaviorState the §6 micro-behavior
   * functions read. Null when no snapshot (the chat turn then skips behavior and
   * the client's pacing.ts uses its local defaults — never blocks the reply).
   */
  private behaviorStateFrom(snap: StateSnapshot | null): BehaviorState | null {
    if (!snap) return null;
    const act = snap.currentActivity;
    const busy = Boolean(act?.busy);
    const asleep = act?.activity === 'sleep' || snap.asleep;
    // minutes until the current busy/sleep block ends drives the believable
    // long-tail acknowledge in replyLatency's busy override.
    const minsUntilBlockEnds = act ? Math.max(0, act.minsUntilNext) : 0;
    return {
      moodP: snap._derived.mood.P,
      moodA: snap._derived.mood.A,
      energy: snap.energy,
      closeness: snap.closeness,
      stage: snap.stage,
      busy,
      asleep,
      minsUntilBlockEnds,
    };
  }

  /** Mark a user turn: lastUserAt=now, clear unread, reschedule next nudge. */
  private async markUserTurn(personaId: string): Promise<void> {
    const now = new Date();
    // Clear assistant proactive nudges the user has now "opened".
    await this.prisma.chatMessage.updateMany({
      where: { personaId, role: 'assistant', proactive: true, readAt: null },
      data: { readAt: now },
    });
    // Read receipts: the persona is now "seeing" the user's prior unread inbound
    // messages — stamp readAt on them so the UI can show double ticks (✓✓ = seen).
    await this.prisma.chatMessage.updateMany({
      where: { personaId, role: 'user', readAt: null },
      data: { readAt: now },
    });
    await this.prisma.persona.update({
      where: { id: personaId },
      data: { lastUserAt: now, nextNudgeAt: scheduleNextNudge(now) },
    });
  }

  async messages(
    userId: string,
    personaId: string,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    await this.personas.getOwned(userId, personaId);
    const rows = await this.prisma.chatMessage.findMany({
      where: { personaId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        kind: true,
        imageFile: true,
        audioFile: true,
        transcript: true,
        proactive: true,
        readAt: true,
        createdAt: true,
      },
    });
    return rows.reverse();
  }

  private async loadPersonaFile(persona: Persona): Promise<PersonaFile> {
    const card = parseJson<PersonaCard>(persona.card);
    const exemplars = parseJson<string[]>(persona.exemplars) ?? [];
    const stats = parseJson<CorpusStats>(persona.stats);
    if (!card || !stats || !persona.personaAuthor || !persona.userAuthor) {
      throw new BadRequestException('Persona data is incomplete — rebuild it');
    }
    const rows = await this.prisma.memory.findMany({ where: { personaId: persona.id } });
    const memories: MemoryItem[] = rows.map((m) => {
      const emb = parseEmbedding(m.embedding);
      return {
        id: m.id,
        text: m.text,
        keywords: parseJson<string[]>(m.keywords) ?? [],
        date: m.date ?? '',
        importance: m.importance,
        kind: m.kind,
        source: m.source,
        lastAccessedAt: m.lastAccessedAt?.toISOString(),
        ...(emb ? { embedding: emb } : {}),
      };
    });
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

/**
 * Pick the emoji for an emoji-only tapback reaction. Prefers one of the
 * persona's own top emoji (from CorpusStats / passport) so it reads in-character;
 * falls back to a small warm-default set. Deterministic given the corpus.
 */
function pickReactionEmoji(persona: PersonaFile): string {
  const fromPassport = persona.passport?.topEmoji ?? [];
  const ps = persona.stats.byAuthor[persona.personaAuthor];
  const fromStats = (ps?.topEmoji ?? []).map(([e]) => e);
  const pool = [...fromPassport, ...fromStats].filter((e) => typeof e === 'string' && e.trim());
  if (pool.length) return pool[0];
  return '❤️';
}

/**
 * next nudge = now + random(NUDGE_MIN_MIN..NUDGE_MAX_MIN) minutes, then pushed
 * out of the night-time quiet window (env QUIET_START_HOUR=23, QUIET_END_HOUR=8,
 * TZ_OFFSET_HOURS=3 / Kyiv). If the candidate lands inside the quiet window in
 * local time, it is bumped to QUIET_END_HOUR local that day (or next day if the
 * window started before midnight). Env read at call-time.
 */
export function scheduleNextNudge(from = new Date()): Date {
  const min = Number(process.env.NUDGE_MIN_MIN ?? 20);
  const max = Number(process.env.NUDGE_MAX_MIN ?? 90);
  const lo = Number.isFinite(min) ? min : 20;
  const hi = Number.isFinite(max) && max >= lo ? max : Math.max(lo, 90);
  const minutes = lo + Math.random() * (hi - lo);
  const candidate = new Date(from.getTime() + minutes * 60_000);
  return avoidQuietHours(candidate);
}

function quietConfig(): { start: number; end: number; offsetMs: number } {
  const start = Number(process.env.QUIET_START_HOUR ?? 23);
  const end = Number(process.env.QUIET_END_HOUR ?? 8);
  const off = Number(process.env.TZ_OFFSET_HOURS ?? 3);
  return {
    start: Number.isFinite(start) ? start : 23,
    end: Number.isFinite(end) ? end : 8,
    offsetMs: (Number.isFinite(off) ? off : 3) * 3_600_000,
  };
}

/** True if `when` falls inside the local-tz quiet window. */
export function isQuietHour(when = new Date()): boolean {
  const { start, end, offsetMs } = quietConfig();
  if (start === end) return false;
  const localHour = new Date(when.getTime() + offsetMs).getUTCHours();
  // Window wraps midnight (e.g. 23..8): quiet if hour>=start OR hour<end.
  return start > end ? localHour >= start || localHour < end : localHour >= start && localHour < end;
}

/**
 * If `when` is inside the quiet window, return the next QUIET_END_HOUR (local)
 * boundary as a real instant; otherwise return `when` unchanged.
 */
export function avoidQuietHours(when: Date): Date {
  if (!isQuietHour(when)) return when;
  const { end, offsetMs } = quietConfig();
  // Work in "local" ms (UTC shifted by the offset), set to QUIET_END_HOUR:00,
  // advancing a day if that boundary is not strictly after `when`.
  const local = new Date(when.getTime() + offsetMs);
  const boundary = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), end, 0, 0, 0),
  );
  if (boundary.getTime() <= local.getTime()) boundary.setUTCDate(boundary.getUTCDate() + 1);
  return new Date(boundary.getTime() - offsetMs);
}

/**
 * Index of an opened-but-unclosed marker so its body is never leaked while we
 * wait for the closing "]]": "[[SELFIE:" or the model's improvised colon-variant
 * "[[VOICE:". A complete [[VOICE]] / [[VOICE: …]] is handled by VOICE_MARKER first.
 */
function openMarkerIndex(s: string): number {
  const candidates = [s.indexOf('[[SELFIE:'), s.indexOf('[[VOICE:')].filter((i) => i >= 0);
  return candidates.length ? Math.min(...candidates) : -1;
}

/** How many trailing chars to hold back because they might begin a marker. */
function tailToHold(s: string): number {
  const prefixes = ['[[SELFIE:', '[[VOICE]]', '[[VOICE:'];
  let best = 0;
  for (const p of prefixes) {
    for (let n = Math.min(p.length, s.length); n > best; n--) {
      const tail = s.slice(s.length - n);
      if (p.startsWith(tail)) {
        best = n;
        break;
      }
    }
  }
  return best;
}

/** No API key: 2 real persona lines from exemplars so the UI stays alive. */
function cannedReply(persona: PersonaFile): string[] {
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
  if (!lines.length) return ['hi', "i'm here)"];
  const start = Math.floor(Math.random() * lines.length);
  return [lines[start], lines[(start + 1) % lines.length]].filter(Boolean).slice(0, 2);
}
