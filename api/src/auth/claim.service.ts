import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';

// The no-orphan claim/link transaction, shared by /auth/social and
// /auth/email/verify. Everything runs in one $transaction; User.id is never
// changed. An anon device-token user is upgraded in place (case A) or merged
// into the surviving account (case C) so personas are never orphaned.

export interface IdentityInput {
  provider: 'apple' | 'google';
  sub: string;
  email?: string;
  emailVerified: boolean;
  emailIsPrivateRelay?: boolean;
  appleRefreshToken?: string;
}

@Injectable()
export class ClaimService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the surviving User for a third-party Identity.
   * Cases (spec §claim):
   *   A new-claim  : Identity missing + anon device user D exists -> attach to D
   *   B return     : Identity exists on E, no/own device          -> use E
   *   C merge      : Identity exists on E + different anon D       -> move D->E, delete D
   *   D fresh      : no device + no Identity                       -> create User+Identity
   * Auto-link by email ONLY when both sides are verified-email; else key on sub.
   */
  async claimSocial(input: IdentityInput, deviceToken?: string): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.identity.findUnique({
        where: { provider_providerSub: { provider: input.provider, providerSub: input.sub } },
      });

      const anon = deviceToken
        ? await tx.user.findUnique({ where: { deviceToken } })
        : null;

      // ---- B / C : Identity already exists -> E is the home account ----
      if (existing) {
        const homeId = existing.userId;
        // Persist any first-login Apple fields we didn't have before.
        await this.refreshIdentity(tx, existing.id, input);
        if (anon && anon.id !== homeId) {
          // C: merge the anon device account's data into E, then delete D.
          await this.mergeInto(tx, anon.id, homeId);
        }
        await this.fillUserProfile(tx, homeId, input);
        return tx.user.findUniqueOrThrow({ where: { id: homeId } });
      }

      // ---- Auto-link by verified email (only if both verified) ----
      if (input.email && input.emailVerified) {
        const byEmail = await tx.user.findFirst({
          where: { email: input.email },
          include: { identities: true },
        });
        // Only link if that user reached us through a verified path before
        // (has an identity OR confirmed email). A bare device user with a
        // copy-pasted email does NOT auto-link — that stays sub-keyed (case A/D).
        if (byEmail && byEmail.identities.length > 0) {
          await tx.identity.create({
            data: this.identityData(byEmail.id, input),
          });
          if (anon && anon.id !== byEmail.id) {
            await this.mergeInto(tx, anon.id, byEmail.id);
          }
          await this.fillUserProfile(tx, byEmail.id, input);
          return tx.user.findUniqueOrThrow({ where: { id: byEmail.id } });
        }
      }

      // ---- A : attach Identity to the existing anon device user ----
      if (anon) {
        await tx.identity.create({ data: this.identityData(anon.id, input) });
        await this.fillUserProfile(tx, anon.id, input);
        return tx.user.findUniqueOrThrow({ where: { id: anon.id } });
      }

      // ---- D : fresh user + identity ----
      const user = await tx.user.create({
        data: {
          email: input.email,
          displayName: input.email ? undefined : undefined,
        },
      });
      await tx.identity.create({ data: this.identityData(user.id, input) });
      return user;
    });
  }

  /**
   * Email magic-link claim. There is no Identity row for first-party email;
   * the User.email column is the home key.
   *   - existing verified-email user        -> use it (merge anon if different)
   *   - else anon device user               -> set its email (claim personas)
   *   - else                                -> create fresh email user
   */
  async claimEmail(emailRaw: string, deviceToken?: string): Promise<User> {
    const email = emailRaw.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      const anon = deviceToken
        ? await tx.user.findUnique({ where: { deviceToken } })
        : null;

      // A user that already owns this email via a prior verified login.
      const owner = await tx.user.findFirst({ where: { email } });

      if (owner) {
        if (anon && anon.id !== owner.id) {
          await this.mergeInto(tx, anon.id, owner.id);
        }
        return tx.user.findUniqueOrThrow({ where: { id: owner.id } });
      }

      if (anon) {
        await tx.user.update({ where: { id: anon.id }, data: { email } });
        return tx.user.findUniqueOrThrow({ where: { id: anon.id } });
      }

      return tx.user.create({ data: { email } });
    });
  }

  // ---- helpers --------------------------------------------------------------

  private identityData(userId: string, input: IdentityInput): Prisma.IdentityUncheckedCreateInput {
    return {
      userId,
      provider: input.provider,
      providerSub: input.sub,
      email: input.email,
      emailIsPrivateRelay: input.emailIsPrivateRelay ?? false,
      appleRefreshToken: input.appleRefreshToken,
    };
  }

  /** Persist Apple-once fields (refresh token / email) if they arrived now. */
  private async refreshIdentity(
    tx: Prisma.TransactionClient,
    identityId: string,
    input: IdentityInput,
  ): Promise<void> {
    const patch: Prisma.IdentityUpdateInput = {};
    if (input.appleRefreshToken) patch.appleRefreshToken = input.appleRefreshToken;
    if (input.email) {
      patch.email = input.email;
      patch.emailIsPrivateRelay = input.emailIsPrivateRelay ?? false;
    }
    if (Object.keys(patch).length) {
      await tx.identity.update({ where: { id: identityId }, data: patch });
    }
  }

  /** Fill only-empty User profile fields from the verified identity. */
  private async fillUserProfile(
    tx: Prisma.TransactionClient,
    userId: string,
    input: IdentityInput,
  ): Promise<void> {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const patch: Prisma.UserUpdateInput = {};
    if (!user.email && input.email && input.emailVerified) patch.email = input.email;
    if (Object.keys(patch).length) {
      await tx.user.update({ where: { id: userId }, data: patch });
    }
  }

  /** Move all of D's owned rows to E, then delete D. E survives. */
  private async mergeInto(
    tx: Prisma.TransactionClient,
    fromId: string,
    toId: string,
  ): Promise<void> {
    await tx.persona.updateMany({ where: { userId: fromId }, data: { userId: toId } });
    await tx.pushSubscription.updateMany({ where: { userId: fromId }, data: { userId: toId } });
    // Move identities that don't collide with one E already has.
    const fromIdentities = await tx.identity.findMany({ where: { userId: fromId } });
    for (const id of fromIdentities) {
      const clash = await tx.identity.findUnique({
        where: { provider_providerSub: { provider: id.provider, providerSub: id.providerSub } },
      });
      if (clash && clash.userId !== fromId) continue; // E already has it
      await tx.identity.update({ where: { id: id.id }, data: { userId: toId } });
    }
    // Refresh tokens of the dead account are dropped (will cascade on delete).
    await tx.user.delete({ where: { id: fromId } });
  }
}
