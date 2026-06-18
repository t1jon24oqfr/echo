import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { EmailService, type SendCodeResult } from './email.service';

// First-party email magic-link/OTP. A 6-digit code, hashed at rest, single-use,
// 10-min TTL. Satisfies Apple 4.8's "own account setup" carve-out (no password).

const CODE_TTL_MS = 1000 * 60 * 10; // 10 min

@Injectable()
export class EmailOtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: EmailService,
  ) {}

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private normalize(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Mint + persist a code and dispatch it. Returns mail result (may carry devCode). */
  async start(emailRaw: string): Promise<{ email: string; result: SendCodeResult }> {
    const email = this.normalize(emailRaw);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.emailOtp.create({
      data: {
        email,
        codeHash: this.hash(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    const result = await this.mail.sendLoginCode(email, code);
    return { email, result };
  }

  /**
   * Validate a code for an email. Consumes the matching unexpired OTP.
   * Returns true on success. The email is treated as verified by virtue of
   * the holder proving control of the inbox.
   */
  async verify(emailRaw: string, code: string): Promise<boolean> {
    const email = this.normalize(emailRaw);
    const row = await this.prisma.emailOtp.findFirst({
      where: {
        email,
        codeHash: this.hash(code),
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return false;
    await this.prisma.emailOtp.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }
}
