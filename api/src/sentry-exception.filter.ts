import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import type { Request } from 'express';

/**
 * Global exception filter that reports unhandled / server-side errors to
 * Sentry/GlitchTip, logs them as structured JSON to stdout (so loki-dbb
 * ingests them), then defers to Nest's BaseExceptionFilter for the actual
 * HTTP response (so response behaviour is byte-for-byte unchanged).
 *
 * Why this and not just Sentry.setupExpressErrorHandler(app): NestJS catches
 * route-handler errors in its own ExceptionsHandler and writes the 500 itself,
 * so the error never reaches the Express-level error middleware that the Sentry
 * Express handler hooks. With @sentry/node (no @sentry/nestjs), capture must
 * therefore happen inside a Nest filter.
 *
 * Only genuine server faults are forwarded/logged: 4xx HttpExceptions
 * (validation, not-found, throttling, auth) are expected client errors and are
 * NOT sent, to keep GlitchTip + log signal clean. 5xx HttpExceptions and any
 * non-HttpException (the real bugs) are captured and logged. Sentry capture is
 * a no-op when SENTRY_DSN is unset because Sentry.init never ran; the stdout
 * log line is unconditional for 5xx so request errors are visible even without
 * a DSN.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      Sentry.captureException(exception);
      this.logError(exception, status, host);
    }
    super.catch(exception, host);
  }

  /**
   * Emit a single structured JSON line to stdout for a server fault. Kept to
   * method/path/status + error class/message/stack only — NO request body,
   * headers, query, or params — so device tokens / PII never reach the logs
   * (consistent with instrument.ts `sendDefaultPii: false`). Best-effort:
   * logging must never itself throw out of the filter.
   */
  private logError(
    exception: unknown,
    status: number,
    host: ArgumentsHost,
  ): void {
    try {
      const req = host.switchToHttp().getRequest<Request>();
      const err =
        exception instanceof Error
          ? {
              name: exception.name,
              message: exception.message,
              stack: exception.stack,
            }
          : { name: 'NonError', message: String(exception) };
      const line = {
        level: 'error',
        service: 'echo-api',
        msg: 'request_error',
        time: new Date().toISOString(),
        status,
        method: req?.method,
        path: req?.originalUrl ?? req?.url,
        error: err,
      };
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(line));
    } catch {
      // Never let logging failure mask the original error / break the response.
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          level: 'error',
          service: 'echo-api',
          msg: 'request_error_log_failed',
          time: new Date().toISOString(),
          status,
        }),
      );
    }
  }
}
