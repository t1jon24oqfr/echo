import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

/**
 * Global exception filter that reports unhandled / server-side errors to
 * Sentry/GlitchTip, then defers to Nest's BaseExceptionFilter for the actual
 * HTTP response (so response behaviour is byte-for-byte unchanged).
 *
 * Why this and not just Sentry.setupExpressErrorHandler(app): NestJS catches
 * route-handler errors in its own ExceptionsHandler and writes the 500 itself,
 * so the error never reaches the Express-level error middleware that the Sentry
 * Express handler hooks. With @sentry/node (no @sentry/nestjs), capture must
 * therefore happen inside a Nest filter.
 *
 * Only genuine server faults are forwarded: 4xx HttpExceptions (validation,
 * not-found, throttling, auth) are expected client errors and are NOT sent, to
 * keep GlitchTip signal clean. 5xx HttpExceptions and any non-HttpException
 * (the real bugs) are captured. No-op overall when SENTRY_DSN is unset because
 * Sentry.init never ran.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
