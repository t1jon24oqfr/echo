import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit by the REAL client IP. Behind DigitalOcean App Platform the request
 * reaches the pod through an ingress proxy, so `req.ip` is the proxy's address
 * and every visitor would share one bucket. We read the left-most hop of
 * `x-forwarded-for` (the original client) instead. Single-pod deployment
 * (instance_count=1), so the in-memory throttler store is authoritative.
 *
 * Anonymous abuse — the live threat — runs from one IP minting many anon device
 * tokens and draining paid LLM/fal/TTS calls; IP-keying is the right signal for
 * it. Authenticated users still get their own per-route budgets on top.
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const xff = headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    const ip = typeof req.ip === 'string' ? req.ip : undefined;
    const socket = req.socket as { remoteAddress?: string } | undefined;
    return ip ?? socket?.remoteAddress ?? 'unknown';
  }
}
