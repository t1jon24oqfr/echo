import { Controller, Get, UseGuards } from '@nestjs/common';
import { MetricsAccessGuard } from '../metrics/metrics-access.guard';

/**
 * Private-only smoke-test for Sentry/GlitchTip error-capture wiring.
 *
 * `GET /debug/sentry` deliberately throws so the Sentry Express error handler
 * (registered in main.ts) reports a real exception to GlitchTip — used to PROVE
 * capture works end-to-end after deploy. Gated by MetricsAccessGuard (identical
 * to /metrics): reachable ONLY from the private container/host network, never
 * from the public Cloudflare tunnel (any cf-* header → 404, non-RFC1918 peer →
 * 404), so it is indistinguishable from a missing route to external callers and
 * cannot be used to DoS the app from the internet.
 */
@Controller('debug')
@UseGuards(MetricsAccessGuard)
export class SentryDebugController {
  @Get('sentry')
  trigger(): never {
    throw new Error('echo-api Sentry capture smoke-test (private /debug/sentry)');
  }
}
