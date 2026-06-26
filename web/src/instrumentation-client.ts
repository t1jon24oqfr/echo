// Next.js browser instrumentation (App Router).
//
// Initialises Sentry/GlitchTip in the browser so client-side runtime errors are
// captured. The DSN public key is client-embeddable (like any Sentry DSN), so
// it is read from NEXT_PUBLIC_SENTRY_DSN, inlined at build time. Purely
// additive: when the env is unset Sentry.init is a no-op.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

// Required by @sentry/nextjs to instrument client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
