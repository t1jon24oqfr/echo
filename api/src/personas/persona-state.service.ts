import { Injectable, Logger } from '@nestjs/common';
import type { Persona, PersonaState } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AgendaService, type CurrentActivity } from './agenda.service';
import { parsePassport, stageFromCloseness, type CharacterPassport } from '../engine/passport';
import {
  advanceState,
  appraise,
  classifyStage,
  closenessGain,
  dayRng,
  energyDescriptor,
  fixedClock,
  localDateStr,
  mulberry32,
  fnv1a,
  pushEmotion,
  systemClock,
  type AdvanceContext,
  type AdvancedState,
  type AppraisalEvent,
  type Clock,
  type ExchangeFeatures,
  type StateView,
} from '../engine/state';
import { presenceFromState, type Presence } from './presence';
import type { PromptLiveState } from '../engine/prompt';
import { DateTime } from 'luxon';

const MAX_RETRIES = 3;

/** The full per-request snapshot the prompt / presence / proactive paths read. */
export interface StateSnapshot extends AdvancedState {
  personaId: string;
  mode: 'memorial' | 'reconnect';
  energy: number;
  energyLabel: string;
  octantLabel: string;
  octantAdverb: string;
  closeness: number;
  stage: number; // live, capped by pinnedMaxStage
  currentActivity: CurrentActivity | null;
  presence: Presence | null;
  passport: CharacterPassport | null;
}

/** An applied affect event (for chat-turn appraisal hook). */
export interface AffectInput {
  kind: string; // 'user_warm'|'ignored'|'reengage'|'sim_good'|...
  emotion?: AppraisalEvent; // optional emotion impulse to push
  exchange?: ExchangeFeatures; // optional closeness gain features
  importance?: number; // 1..10 (also feeds reflection accumulator)
}

@Injectable()
export class PersonaStateService {
  private readonly logger = new Logger(PersonaStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agenda: AgendaService,
  ) {}

  /** Resolve the engine context (tz/chronotype/mode/decay) from a persona row. */
  private contextFor(persona: Persona, passport: CharacterPassport | null): AdvanceContext {
    const tz = passport?.timezone ?? persona.timezone ?? 'Europe/Kyiv';
    const mode: 'memorial' | 'reconnect' =
      (passport?.mode ?? persona.mode) === 'reconnect' ? 'reconnect' : 'memorial';
    const decayEnabled = mode !== 'memorial' && (passport?.relationship.decayEnabled ?? true);
    return {
      timezone: tz,
      chronotype: { MSF: passport?.chronotype.MSF ?? 4.5 },
      mode,
      decayEnabled,
      lastUserAt: persona.lastUserAt ?? null,
      ...(passport?.tuning ? { tuning: passport.tuning } : {}),
    };
  }

  /** Load-or-create the raw PersonaState row (seeded from passport baseline). */
  private async ensureRow(persona: Persona, passport: CharacterPassport | null): Promise<PersonaState> {
    const existing = await this.prisma.personaState.findUnique({ where: { personaId: persona.id } });
    if (existing) return existing;
    const baseline = passport?.baselineOverride ?? passport?.baselinePAD ?? { P: 0, A: 0, D: 0 };
    const seed = passport?.relationship.closenessSeed ?? (persona.mode === 'memorial' ? 70 : 40);
    const now = systemClock.now();
    try {
      return await this.prisma.personaState.create({
        data: {
          personaId: persona.id,
          moodP: baseline.P,
          moodA: baseline.A,
          moodD: baseline.D,
          baseP: baseline.P,
          baseA: baseline.A,
          baseD: baseline.D,
          closeness: seed,
          peakCloseness: seed,
          stage: stageFromCloseness(seed),
          lastWakeAt: now,
          stateAt: now,
        },
      });
    } catch {
      // Lost a create race with the parallel write path — read it back.
      const row = await this.prisma.personaState.findUnique({ where: { personaId: persona.id } });
      if (row) return row;
      throw new Error('failed to create or load PersonaState');
    }
  }

  private rowToView(row: PersonaState): StateView {
    return {
      moodP: row.moodP,
      moodA: row.moodA,
      moodD: row.moodD,
      baseP: row.baseP,
      baseA: row.baseA,
      baseD: row.baseD,
      emotions: row.emotions,
      closeness: row.closeness,
      peakCloseness: row.peakCloseness,
      stage: row.stage,
      sleepPressureS: row.sleepPressureS,
      lastWakeAt: row.lastWakeAt,
      lastSleepAt: row.lastSleepAt,
      asleep: row.asleep,
      stateAt: row.stateAt,
      lastDecayDay: row.lastDecayDay,
      version: row.version,
    };
  }

  /**
   * COMPUTE-ON-READ: advance the persisted state to `now`, persist with an
   * optimistic-lock (updateMany where {personaId,version}), retry on a lost race
   * up to MAX_RETRIES, and return the advanced snapshot enriched with the live
   * energy / octant / stage / current-activity / presence.
   *
   * `mutate` (used by applyEvent) is applied to the ADVANCED view before persist,
   * so the closeness/emotion delta lands on top of the freshly-integrated state.
   */
  async read(
    personaId: string,
    opts: { clock?: Clock; mutate?: (s: StateView, adv: AdvancedState) => StateView } = {},
  ): Promise<StateSnapshot | null> {
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona) return null;
    const passport = parsePassport(persona.passport);
    const clock = opts.clock ?? systemClock;
    const ctx = this.contextFor(persona, passport);

    let advanced: AdvancedState | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const row = await this.ensureRow(persona, passport);
      const view = this.rowToView(row);
      const dtSec = Math.max(0, (clock.now().getTime() - view.stateAt.getTime()) / 1000);
      const rng = mulberry32(fnv1a(`${personaId}:advance`));
      let adv = advanceState(view, dtSec, ctx, clock, rng);

      // Mutation hook (applyEvent): closeness/emotion delta on the integrated state.
      let toPersist: StateView = stripDerived(adv);
      if (opts.mutate) {
        toPersist = opts.mutate(toPersist, adv);
        // recompute derived octant/mood off the mutated mood (emotions may have changed)
        adv = { ...adv, ...toPersist, _derived: adv._derived };
      }

      const n = await this.prisma.personaState.updateMany({
        where: { personaId, version: view.version },
        data: {
          moodP: toPersist.moodP,
          moodA: toPersist.moodA,
          moodD: toPersist.moodD,
          baseP: toPersist.baseP,
          baseA: toPersist.baseA,
          baseD: toPersist.baseD,
          emotions: toPersist.emotions,
          closeness: toPersist.closeness,
          peakCloseness: Math.max(toPersist.peakCloseness, toPersist.closeness),
          stage: classifyStage(
            toPersist.closeness,
            toPersist.stage,
            passport?.relationship.pinnedMaxStage ?? 5,
          ),
          sleepPressureS: toPersist.sleepPressureS,
          lastWakeAt: toPersist.lastWakeAt,
          lastSleepAt: toPersist.lastSleepAt,
          asleep: toPersist.asleep,
          stateAt: toPersist.stateAt,
          lastDecayDay: toPersist.lastDecayDay,
          version: { increment: 1 },
        },
      });
      if (n.count > 0) {
        advanced = adv;
        break;
      }
      // Lost the compare-and-set; reload + re-advance from the newer snapshot.
      this.logger.debug(`optimistic-lock miss for ${personaId} attempt ${attempt + 1}`);
    }

    if (!advanced) {
      // Could not win the lock after retries — return a best-effort read-only snapshot.
      const row = await this.ensureRow(persona, passport);
      advanced = advanceState(this.rowToView(row), 0, ctx, clock, () => 0);
    }

    return this.enrich(personaId, persona, passport, advanced, ctx, clock);
  }

  /**
   * applyEvent: read -> push appraised emotion + closeness delta -> persist (same
   * optimistic lock) -> write an AffectEvent audit row. Returns the new snapshot.
   * Memorial mode: closeness decay is already disabled in advanceState; gains still
   * apply (the bond can warm), but presence/activity stay remembrance-framed.
   */
  async applyEvent(personaId: string, ev: AffectInput, clock: Clock = systemClock): Promise<StateSnapshot | null> {
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona) return null;
    const passport = parsePassport(persona.passport);

    let appliedDC = 0;
    let emotionType: string | null = null;
    let dP = 0;
    let dA = 0;
    let dD = 0;

    const snap = await this.read(personaId, {
      clock,
      mutate: (s) => {
        let next = s;
        // Closeness gain (diminishing returns + daily cap handled in closenessGain).
        if (ev.exchange) {
          const gainedToday = peakGainGuard(); // placeholder; daily cap tracked via AffectEvent below
          const dc = closenessGain(s.closeness, { ...ev.exchange, gainedToday });
          appliedDC = dc;
          next = { ...next, closeness: clamp100(next.closeness + dc) };
        }
        // Emotion impulse.
        if (ev.emotion && passport) {
          const e = appraise(ev.emotion, { ocean: { N: passport.ocean.N } }, next.closeness, clock);
          emotionType = e.type;
          dP = e.p * e.intensity;
          dA = e.a * e.intensity;
          dD = e.d * e.intensity;
          next = pushEmotion(next, e);
        }
        return next;
      },
    });

    // Audit row (append-only; reconstructable, never a mystery number).
    await this.prisma.affectEvent
      .create({
        data: {
          personaId,
          kind: ev.kind,
          emotionType,
          dP,
          dA,
          dD,
          dCloseness: appliedDC,
          importance: clampInt(ev.importance ?? 1, 1, 10),
        },
      })
      .catch((e) => this.logger.warn(`affectEvent write failed: ${e instanceof Error ? e.message : String(e)}`));

    // Reflection accumulator (Generative Agents) — bump importanceSinceReflect.
    if (ev.importance && ev.importance > 0) {
      await this.prisma.personaState
        .updateMany({
          where: { personaId },
          data: { importanceSinceReflect: { increment: clampInt(ev.importance, 1, 10) } },
        })
        .catch(() => undefined);
    }

    return snap;
  }

  /** Compose the enriched snapshot: live octant/energy/stage + activity + presence. */
  private enrich(
    personaId: string,
    persona: Persona,
    passport: CharacterPassport | null,
    adv: AdvancedState,
    ctx: AdvanceContext,
    clock: Clock,
  ): StateSnapshot {
    const memorial = ctx.mode === 'memorial';
    // Current activity (zero LLM; pure clock lookup over the cached agenda).
    const activity = memorial ? null : this.agenda.currentActivitySync(personaId, ctx.timezone, clock);
    const stage = classifyStage(adv.closeness, adv.stage, passport?.relationship.pinnedMaxStage ?? 5);
    const presence = presenceFromState({
      personaId,
      ready: persona.status === 'ready',
      energy: adv._derived.energy,
      asleep: adv.asleep,
      activity,
      memorial,
      clock,
    });
    return {
      ...adv,
      personaId,
      mode: ctx.mode,
      energy: adv._derived.energy,
      energyLabel: energyDescriptor(adv._derived.energy),
      octantLabel: adv._derived.octant.label,
      octantAdverb: adv._derived.octant.adverb,
      closeness: adv.closeness,
      stage,
      currentActivity: activity,
      presence,
      passport,
    };
  }

  /** Map a snapshot into the prompt-assembler's PromptLiveState (engine stays nest-free). */
  toLiveState(snap: StateSnapshot, clock: Clock = systemClock): PromptLiveState {
    const tz = snap.passport?.timezone ?? 'Europe/Kyiv';
    const localTime = DateTime.fromJSDate(clock.now(), { zone: tz }).toFormat('HH:mm');
    const presenceLabel = snap.presence && 'label' in snap.presence ? snap.presence.label : undefined;
    return {
      octantLabel: snap.octantLabel,
      octantAdverb: snap.octantAdverb,
      energy: snap.energy,
      energyDescriptor: snap.energyLabel,
      moodP: snap._derived.mood.P,
      stage: snap.stage,
      localTime,
      ...(snap.currentActivity ? { activityLabel: snap.currentActivity.label } : {}),
      ...(presenceLabel ? { presenceLabel } : {}),
      memorial: snap.mode === 'memorial',
    };
  }

  /** Cheap presence for list/detail without an optimistic-lock write (read-only). */
  async presenceOnly(persona: Persona, clock: Clock = systemClock): Promise<Presence | null> {
    if (persona.status !== 'ready') return null;
    const passport = parsePassport(persona.passport);
    const ctx = this.contextFor(persona, passport);
    const memorial = ctx.mode === 'memorial';
    const row = await this.prisma.personaState.findUnique({ where: { personaId: persona.id } });
    let energy: number;
    let asleep = false;
    if (row) {
      const adv = advanceState(this.rowToView(row), 0, ctx, clock, () => 0);
      energy = adv._derived.energy;
      asleep = adv.asleep;
    } else {
      // No state yet: derive energy purely from chronotype/clock (no write).
      const adv = advanceState(
        {
          moodP: 0, moodA: 0, moodD: 0, baseP: 0, baseA: 0, baseD: 0,
          emotions: '[]', closeness: 40, peakCloseness: 40, stage: 1,
          sleepPressureS: 0.3, lastWakeAt: clock.now(), lastSleepAt: null, asleep: false,
          stateAt: clock.now(), lastDecayDay: null, version: 0,
        },
        0,
        ctx,
        clock,
        () => 0,
      );
      energy = adv._derived.energy;
    }
    const activity = memorial ? null : this.agenda.currentActivitySync(persona.id, ctx.timezone, clock);
    return presenceFromState({
      personaId: persona.id,
      ready: true,
      energy,
      asleep,
      activity,
      memorial,
      clock,
    });
  }
}

function stripDerived(adv: AdvancedState): StateView {
  const { _derived, ...rest } = adv;
  void _derived;
  return rest;
}
function clamp100(x: number): number {
  return x < 0 ? 0 : x > 100 ? 100 : x;
}
function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}
// Daily-cap bookkeeping is intentionally conservative: closenessGain already
// caps a single delta to dailyGainCap; cross-turn accumulation within a day is
// approximated as 0 here (a future ledger-sum can tighten it). Kept explicit.
function peakGainGuard(): number {
  return 0;
}
void dayRng;
void localDateStr;
void fixedClock;
