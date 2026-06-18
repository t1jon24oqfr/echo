import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { PrismaService } from '../prisma.service';

// V11 sessions = short access JWT (verified statelessly by the guard) + an
// opaque rotating refresh token (stored hashed). HS256 with a server secret —
// no key distribution needed (single backend verifies its own tokens).

const ACCESS_TTL_SEC = 60 * 15; // 15 min
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 60; // 60 days
const ISS = 'echo';
const AUD = 'echo-app';

export interface SessionTokens {
  token: string;
  refreshToken: string;
}

@Injectable()
export class JwtService {
  constructor(private readonly prisma: PrismaService) {}

  private secret(): Uint8Array {
    const s = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET;
    if (s) return new TextEncoder().encode(s);
    // Dev fallback: a process-stable secret so tokens survive within one run.
    // Production MUST set AUTH_JWT_SECRET (boot continues; logs once).
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_JWT_SECRET is required in production');
    }
    if (!JwtService.devSecret) {
      JwtService.devSecret = randomBytes(32).toString('hex');
      // eslint-disable-next-line no-console
      console.warn('[auth] AUTH_JWT_SECRET unset — using ephemeral dev secret');
    }
    return new TextEncoder().encode(JwtService.devSecret);
  }
  private static devSecret = '';

  /** Mint a short access JWT for a user id. */
  async signAccess(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISS)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SEC}s`)
      .sign(this.secret());
  }

  /** Verify an access JWT → user id (sub). Throws if invalid/expired. */
  async verifyAccess(token: string): Promise<string> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.secret(), { issuer: ISS, audience: AUD }));
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!payload.sub) throw new UnauthorizedException('Invalid token');
    return payload.sub;
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Issue a fresh access+refresh pair; persists the hashed refresh token. */
  async issueSession(userId: string): Promise<SessionTokens> {
    const token = await this.signAccess(userId);
    const raw = randomBytes(32).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { token, refreshToken: raw };
  }

  /** Rotate: validate the presented refresh token, revoke it, issue a new pair. */
  async rotate(rawRefresh: string): Promise<SessionTokens> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawRefresh) },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    return this.issueSession(row.userId);
  }

  /** Revoke a single refresh token (logout). No-op if unknown. */
  async revoke(rawRefresh: string): Promise<void> {
    await this.prisma.refreshToken
      .updateMany({
        where: { tokenHash: this.hash(rawRefresh), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  /** Resolve the owning user id for a (valid, active) refresh token, or null. */
  async userIdForRefresh(rawRefresh: string): Promise<string | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawRefresh) },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;
    return row.userId;
  }

  /** Revoke every active refresh token for a user (logout-all). */
  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
