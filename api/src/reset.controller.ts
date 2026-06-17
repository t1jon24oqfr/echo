import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { DeviceTokenGuard, type AuthedRequest } from './auth/device-token.guard';
import { PrismaService } from './prisma.service';
import { StorageService } from './personas/storage.service';

@Controller()
@UseGuards(DeviceTokenGuard)
export class ResetController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Dev convenience: wipe ALL data of this user (personas cascade to memories/photos/messages). */
  @Post('reset')
  async reset(@Req() req: AuthedRequest): Promise<{ ok: true }> {
    const personas = await this.prisma.persona.findMany({
      where: { userId: req.user.id },
      select: { id: true },
    });
    await this.prisma.persona.deleteMany({ where: { userId: req.user.id } });
    for (const p of personas) {
      await this.storage.deletePersonaFiles(p.id);
    }
    return { ok: true };
  }
}
