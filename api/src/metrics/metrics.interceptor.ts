import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Global, read-only HTTP SLI recorder. It only times requests and feeds two
 * counters/histograms in MetricsService — it never reads or mutates the body,
 * auth, or business state, so it cannot affect request handling. Errors are
 * timed too (via the error tap) so 5xx latency is not lost.
 *
 * Route label = the matched Express route *pattern* (e.g. `/personas/:id`),
 * never the raw URL, to keep Prometheus label cardinality bounded. The /metrics
 * scrape itself is excluded so the scraper doesn't inflate its own series.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    if (req.path === '/metrics') {
      return next.handle();
    }

    const start = process.hrtime.bigint();
    const record = (): void => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.observe(
        req.method,
        this.routeOf(context, req),
        res.statusCode,
        seconds,
      );
    };

    return next.handle().pipe(
      tap({
        next: record,
        error: record,
      }),
    );
  }

  /** Low-cardinality route label: prefer the matched route pattern. */
  private routeOf(context: ExecutionContext, req: Request): string {
    const route = (req as Request & { route?: { path?: string } }).route;
    if (route?.path) return route.path;
    // Fallback before the route is resolved (e.g. 404s): the handler name.
    const handler = context.getHandler?.().name;
    return handler ? `handler:${handler}` : 'unmatched';
  }
}
