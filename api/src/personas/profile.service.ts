import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PersonasService, parseJson } from './personas.service';
import { BuildService } from './build.service';
import {
  normalizePassport,
  parsePassport,
  mergePassport,
  changedFields,
  type CharacterPassport,
  type Provenance,
} from '../engine/passport';
import type { Conversation, CorpusStats, PersonaCard } from '../engine/types';

export interface ProfileResponse {
  passport: CharacterPassport | null;
  passportVersion: number;
  timezone: string;
}

/**
 * Phase-1 Character Studio backend: GET/PATCH the persona's Character Passport
 * (+ optional regenerate for fields still 'auto'). Owner-checked via
 * PersonasService.getOwned. Mode invariants are re-enforced on every write.
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly personas: PersonasService,
    private readonly build: BuildService,
  ) {}

  /** GET /personas/:id/profile -> { passport (parsed+normalized), passportVersion, timezone }. */
  async getProfile(userId: string, personaId: string): Promise<ProfileResponse> {
    const persona = await this.personas.getOwned(userId, personaId);
    const passport = parsePassport(persona.passport);
    return {
      passport,
      passportVersion: persona.passportVersion,
      timezone: persona.timezone,
    };
  }

  /**
   * PATCH /personas/:id/profile — deep-merge the patch into the stored passport,
   * re-normalize (recomputes baselinePAD when ocean changed), flip touched fields
   * to provenance 'edited', re-enforce memorial invariants, bump passportVersion.
   */
  async updateProfile(
    userId: string,
    personaId: string,
    body: { passport?: Partial<CharacterPassport>; timezone?: string },
  ): Promise<ProfileResponse> {
    const persona = await this.personas.getOwned(userId, personaId);

    // Base: stored passport, or a fresh normalized one seeded from this persona's
    // mode/name/timezone if none exists yet (so PATCH always works).
    const stored = parsePassport(persona.passport);
    const base: CharacterPassport =
      stored ??
      normalizePassport({
        name: persona.name,
        relationshipToUser: persona.relationship,
        mode: persona.mode === 'reconnect' ? 'reconnect' : 'memorial',
        timezone: persona.timezone,
      });

    const patch = body.passport ?? {};
    // mode is immutable from the profile editor — it owns the ethical invariants.
    delete (patch as Record<string, unknown>).mode;
    // _provenance / _version are server-owned.
    delete (patch as Record<string, unknown>)._provenance;
    delete (patch as Record<string, unknown>)._version;

    const merged = mergePassport(base, patch);
    // Carry mode + a possibly-updated timezone into the merged partial.
    merged.mode = base.mode;
    if (typeof body.timezone === 'string' && body.timezone) merged.timezone = body.timezone;

    const next = normalizePassport(merged);

    // Flip provenance to 'edited' for every top-level field that actually changed.
    const changed = changedFields(base, next);
    const provenance: Record<string, Provenance> = { ...base._provenance };
    for (const f of changed) provenance[f] = 'edited';
    // baselinePAD is derived: if ocean changed, the recompute counts as 'edited' too.
    if (changed.includes('ocean')) provenance.baselinePAD = 'edited';
    next._provenance = provenance;

    const newVersion = persona.passportVersion + 1;
    next._version = newVersion;

    // Persist passport + the mirrored Persona.timezone/passportVersion columns.
    await this.prisma.persona.update({
      where: { id: personaId },
      data: {
        passport: JSON.stringify(next),
        passportVersion: newVersion,
        timezone: next.timezone,
      },
    });

    this.logger.log(`passport edited for ${personaId}: [${changed.join(', ')}] -> v${newVersion}`);
    return { passport: next, passportVersion: newVersion, timezone: next.timezone };
  }

  /**
   * POST /personas/:id/profile/regenerate (nice-to-have) — re-run the build-time
   * auto-fill, then preserve any user-edited fields (provenance 'edited' is never
   * overwritten). Returns the refreshed profile.
   */
  async regenerate(userId: string, personaId: string): Promise<ProfileResponse> {
    const persona = await this.personas.getOwned(userId, personaId);
    const before = parsePassport(persona.passport);

    const corpus = await this.loadCorpusForRegen(persona.id);
    if (!corpus) {
      // No corpus left (deleted post-build): just return current profile unchanged.
      this.logger.warn(`regenerate skipped for ${personaId}: corpus unavailable`);
      return this.getProfile(userId, personaId);
    }

    const card = parseJson<PersonaCard>(persona.card);
    const stats = parseJson<CorpusStats>(persona.stats);
    if (!card || !stats || !persona.personaAuthor) {
      return this.getProfile(userId, personaId);
    }

    await this.build
      .buildPassportPublic(personaId, card, stats, corpus.conversations, persona.personaAuthor)
      .catch((e) =>
        this.logger.warn(`regenerate auto-fill failed: ${e instanceof Error ? e.message : String(e)}`),
      );

    // Re-apply any edited fields from the previous passport over the fresh one.
    if (before) {
      const fresh = parsePassport(
        (await this.prisma.persona.findUnique({ where: { id: personaId } }))?.passport,
      );
      if (fresh) {
        const editedFields = Object.entries(before._provenance ?? {})
          .filter(([, p]) => p === 'edited')
          .map(([f]) => f);
        if (editedFields.length) {
          const restore: Partial<CharacterPassport> = {};
          for (const f of editedFields) {
            (restore as Record<string, unknown>)[f] = (before as unknown as Record<string, unknown>)[f];
          }
          const merged = normalizePassport(mergePassport(fresh, restore));
          merged._provenance = { ...fresh._provenance };
          for (const f of editedFields) merged._provenance[f] = 'edited';
          merged._version = persona.passportVersion + 1;
          await this.prisma.persona.update({
            where: { id: personaId },
            data: { passport: JSON.stringify(merged), passportVersion: merged._version },
          });
        }
      }
    }

    return this.getProfile(userId, personaId);
  }

  private async loadCorpusForRegen(
    personaId: string,
  ): Promise<{ conversations: Conversation[] } | null> {
    // StorageService deletes the raw corpus after a successful build, so regenerate
    // is best-effort. We reach it through BuildService's storage if still present.
    return this.build.tryReadCorpusForRegen(personaId);
  }
}
