import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Owns a private prom-client Registry (NOT the global default one) so this
 * module is self-contained and side-effect-free for the rest of the app: it
 * registers only the metrics it creates here and never touches global state.
 *
 * Exposes Node/process default metrics (event-loop lag, GC, heap, fds, …) plus
 * two HTTP SLI series populated by MetricsInterceptor. Scraped on the app port
 * by Prometheus over the internal app-b/container network only — /metrics is
 * NOT routed by the public Cloudflare tunnel ingress (see deploy notes).
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  /** Total HTTP requests, labelled by method, normalized route, status code. */
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status'>;

  /** HTTP request latency in seconds, same label set. */
  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status'>;

  constructor() {
    this.registry.setDefaultLabels({ app: 'echo-api' });

    // Node/process defaults (cpu, memory, event loop lag, GC, handles, …).
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests handled.',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds.',
      labelNames: ['method', 'route', 'status'] as const,
      // Web-API oriented buckets: sub-10ms health checks up to slow LLM/media
      // routes that legitimately take several seconds.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
  }

  /** Record one finished HTTP request. */
  observe(method: string, route: string, status: number, seconds: number): void {
    const labels = { method, route, status: String(status) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, seconds);
  }

  /** Prometheus exposition-format text for the /metrics endpoint. */
  async render(): Promise<string> {
    return this.registry.metrics();
  }

  /** Content-Type header value matching the rendered text. */
  get contentType(): string {
    return this.registry.contentType;
  }
}
