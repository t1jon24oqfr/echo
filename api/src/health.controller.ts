import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Public (no DeviceTokenGuard) — DigitalOcean App Platform health check probes
// this. A cheap `SELECT 1` confirms the PrismaClient is actually connected.
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(): Promise<{ ok: boolean; db: string }> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { ok: true, db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down' });
    }
  }
}
