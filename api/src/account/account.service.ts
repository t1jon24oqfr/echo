import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../personas/storage.service';

// Profile read/update + GDPR export + permanent delete. Delete purges per-persona
// media (R2/local) then relies on Prisma onDelete:Cascade to drop personas, push
// subs, identities and refresh tokens. Apple token revocation is best-effort.

const RELAY_DOMAINS = ['@privaterelay.appleid.com', '@private.icloud.com'];

export interface AccountProfile {
  id: string;
  email: string | null;
  emailIsPrivateRelay: boolean;
  displayName: string | null;
  plan: string;
  ageConfirmedAt: string | null;
  createdAt: string;
  providers: { provider: string; email: string | null; emailIsPrivateRelay: boolean }[];
  hasDeviceToken: boolean;
}

export interface UpdateAccountInput {
  displayName?: string;
  ageConfirmed?: boolean;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private isRelay(email: string | null): boolean {
    if (!email) return false;
    const l = email.toLowerCase();
    return RELAY_DOMAINS.some((d) => l.endsWith(d));
  }

  async getProfile(userId: string): Promise<AccountProfile> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { identities: true },
    });
    return {
      id: user.id,
      email: user.email,
      emailIsPrivateRelay: this.isRelay(user.email),
      displayName: user.displayName,
      plan: user.plan,
      ageConfirmedAt: user.ageConfirmedAt ? user.ageConfirmedAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      providers: user.identities.map((i) => ({
        provider: i.provider,
        email: i.email,
        emailIsPrivateRelay: i.emailIsPrivateRelay,
      })),
      hasDeviceToken: Boolean(user.deviceToken),
    };
  }

  async update(userId: string, input: UpdateAccountInput): Promise<AccountProfile> {
    const data: { displayName?: string; ageConfirmedAt?: Date } = {};
    if (typeof input.displayName === 'string') data.displayName = input.displayName.slice(0, 120);
    if (input.ageConfirmed) data.ageConfirmedAt = new Date();
    if (Object.keys(data).length) {
      await this.prisma.user.update({ where: { id: userId }, data });
    }
    return this.getProfile(userId);
  }

  /** GDPR data export: profile + identities + personas (+ messages/memories). */
  async export(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        identities: true,
        personas: {
          include: { memories: true, photos: true, messages: true },
        },
      },
    });
    // Never export secrets (deviceToken / appleRefreshToken / tokenHashes).
    const { deviceToken: _omit, ...safeUser } = user;
    const sanitized = {
      ...safeUser,
      identities: user.identities.map(({ appleRefreshToken: _a, ...i }) => i),
    };
    return { exportedAt: new Date().toISOString(), user: sanitized };
  }

  /** Permanent delete: purge media, then cascade-delete the User row. */
  async delete(userId: string): Promise<{ ok: true }> {
    const personas = await this.prisma.persona.findMany({
      where: { userId },
      select: { id: true },
    });
    for (const p of personas) {
      await this.storage.deletePersonaFiles(p.id).catch(() => undefined);
    }
    // Cascade drops personas, pushSubs, identities, refreshTokens.
    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  }

  /** Expose the resolved User for delete revocation hooks (Apple) if needed. */
  async getUser(userId: string): Promise<User> {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }
}
