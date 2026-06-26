import { Controller, Get, Header, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { MetricsService } from './metrics.service';
import { MetricsAccessGuard } from './metrics-access.guard';

/**
 * Prometheus scrape endpoint. Intentionally unauthenticated (no
 * DeviceTokenGuard) and @SkipThrottle so the scraper is never rate-limited.
 *
 * Reachability is constrained app-side by {@link MetricsAccessGuard} (parity
 * with voltpay-backend): only internal/loopback/RFC1918/RFC4193 socket peers
 * may scrape, and any request carrying Cloudflare tunnel headers
 * (cf-connecting-ip / cf-ray) gets a 404. The app serves /metrics on its own
 * port (reached by Prometheus over the internal app-b/container network); the
 * public Cloudflare tunnel ingress for echo-1984-api.undress.zone also returns
 * 404 for ^/metrics. Keep both (edge + in-app) in place — defence in depth.
 */
@Controller('metrics')
@UseGuards(MetricsAccessGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.render());
  }
}
