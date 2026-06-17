import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Phase 2 (design spec §2): WAL + busy_timeout make the cron-vs-chat write
    // contention safe and the optimistic-lock pattern a no-op on the future
    // Postgres migration. SQLite-only; harmless to attempt, ignored elsewhere.
    if ((process.env.DATABASE_URL ?? '').startsWith('file:')) {
      try {
        await this.$executeRawUnsafe('PRAGMA journal_mode=WAL;');
        await this.$executeRawUnsafe('PRAGMA busy_timeout=5000;');
      } catch {
        // pragmas are best-effort; never block boot on them.
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
