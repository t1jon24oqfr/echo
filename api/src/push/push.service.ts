import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma.service';

/** A browser PushSubscription as serialized by the Web Push API. */
export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  icon?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Read VAPID env at call-time and configure web-push once we have the keys. */
  private configure(): boolean {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:hello@echo.app';
    if (!publicKey || !privateKey) return false;
    if (!this.configured) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.configured = true;
    }
    return true;
  }

  /** Push is available only when VAPID keys are present. */
  enabled(): boolean {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }

  publicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY || null;
  }

  /** Upsert by endpoint so re-subscribing the same browser is idempotent. */
  async saveSubscription(userId: string, sub: WebPushSubscription): Promise<void> {
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    if (!endpoint) return;
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /**
   * Send a payload to every subscription owned by the user.
   * Never throws into callers: each send is isolated; expired subs (404/410) are pruned.
   * Returns the number of pushes accepted by the push service.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<number> {
    try {
      if (!this.configure()) return 0;
      const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
      if (!subs.length) return 0;
      const body = JSON.stringify(payload);
      const results = await Promise.allSettled(
        subs.map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              body,
            );
            return true;
          } catch (e) {
            const status = (e as { statusCode?: number })?.statusCode;
            if (status === 404 || status === 410) {
              await this.prisma.pushSubscription
                .delete({ where: { endpoint: s.endpoint } })
                .catch(() => undefined);
              this.logger.log(`pruned expired push sub for user ${userId} (status ${status})`);
            } else {
              this.logger.warn(
                `push send failed (user ${userId}): ${e instanceof Error ? e.message : String(e)}`,
              );
            }
            return false;
          }
        }),
      );
      return results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
    } catch (e) {
      this.logger.warn(`sendToUser failed (user ${userId}): ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  }
}
