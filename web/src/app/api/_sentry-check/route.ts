// Private smoke-test for Sentry/GlitchTip server-side capture wiring (echo-web).
//
// GET /api/_sentry-check?token=<SENTRY_DEBUG_TOKEN> sends one synthetic
// exception to GlitchTip (server DSN, project /4) and returns 200 — used to
// PROVE capture works end-to-end after deploy WITHOUT exposing a public crash
// route. Gated by a constant-time token comparison against SENTRY_DEBUG_TOKEN:
// when that env is unset the route always 404s, so it is inert in normal
// operation and cannot be abused from the internet.
import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function GET(req: Request): Promise<NextResponse> {
  const expected = process.env.SENTRY_DEBUG_TOKEN;
  const provided = new URL(req.url).searchParams.get('token') ?? '';
  // Inert unless explicitly enabled with a matching token.
  if (!expected || !timingSafeEqual(provided, expected)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const eventId = Sentry.captureException(
    new Error('echo-web Sentry capture smoke-test (private /api/_sentry-check)'),
  );
  await Sentry.flush(2000);
  return NextResponse.json({ ok: true, eventId });
}
