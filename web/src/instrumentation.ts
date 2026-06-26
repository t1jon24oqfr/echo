// Next.js server/edge instrumentation hook (App Router).
//
// Initialises Sentry/GlitchTip for the Node and Edge server runtimes and wires
// the App Router request-error hook so server-side render / route-handler
// exceptions are captured. Purely additive: when SENTRY_DSN is unset every
// Sentry.init below is a no-op, so the app runs exactly as before.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      tracesSampleRate: 0,
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      tracesSampleRate: 0,
    });
  }
}

// Captures errors thrown during React Server Component / route-handler
// rendering and forwards them to Sentry/GlitchTip.
export const onRequestError = Sentry.captureRequestError;
