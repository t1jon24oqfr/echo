import 'dotenv/config';
// Sentry/GlitchTip must be initialised before anything else so its
// instrumentation is in place before Nest/Express load. No-ops when SENTRY_DSN
// is unset (see instrument.ts).
import './instrument';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { SentryExceptionFilter } from './sentry-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind the DigitalOcean App Platform ingress: trust the first proxy hop so
  // req.ip / x-forwarded-for resolve to the real client (used by rate limiting).
  app.set('trust proxy', 1);
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3047',
    allowedHeaders: ['Content-Type', 'x-device-token', 'Authorization'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Report unhandled / 5xx errors to Sentry/GlitchTip. NestJS catches
  // route-handler errors in its own ExceptionsHandler (they never reach the
  // Express error middleware), so capture must happen inside a Nest filter.
  // Extends BaseExceptionFilter, so the HTTP response is unchanged. No-op when
  // SENTRY_DSN is unset because Sentry.init did not run.
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));
  const port = Number(process.env.PORT ?? 3048);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Echo API listening on :${port}`);
}

void bootstrap();
