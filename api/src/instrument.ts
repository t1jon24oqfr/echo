// Sentry/GlitchTip error-capture bootstrap for the Echo API (NestJS on Express).
//
// MUST be imported before any other module in main.ts so Sentry can install its
// instrumentation (HTTP, etc.) before the framework loads. Purely additive: if
// SENTRY_DSN is unset (e.g. local dev) Sentry.init is a no-op and the process
// behaves exactly as before — no DSN, no network, no capture.
//
// The DSN targets the self-hosted GlitchTip (Sentry-API-compatible) at the
// public host errors.voltpay.pro. It is supplied via the SENTRY_DSN env set in
// the app's Coolify environment.
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    // Errors-only: no performance tracing/profiling (keeps it light + avoids
    // sending PII-bearing spans). Bump tracesSampleRate later if needed.
    tracesSampleRate: 0,
    // Drop default PII (request bodies / headers may carry device tokens).
    sendDefaultPii: false,
  });
}
