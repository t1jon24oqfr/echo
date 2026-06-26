import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint. Intentionally unauthenticated (no
 * DeviceTokenGuard) and @SkipThrottle so the scraper is never rate-limited.
 *
 * Reachability is constrained at the edge, not here: the app serves /metrics on
 * its own port (reached by Prometheus over the internal app-b/container
 * network), while the public Cloudflare tunnel ingress for
 * echo-1984-api.undress.zone returns 404 for ^/metrics. Keep both in place.
 */
@Controller('metrics')
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
