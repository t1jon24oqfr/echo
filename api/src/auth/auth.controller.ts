import { Body, Controller, Post } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma.service';

class DeviceDto {
  @IsOptional()
  @IsString()
  token?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('device')
  async device(@Body() body: DeviceDto): Promise<{ token: string }> {
    if (body.token) {
      const existing = await this.prisma.user.findUnique({ where: { deviceToken: body.token } });
      if (existing) return { token: existing.deviceToken };
    }
    const token = randomBytes(24).toString('hex');
    await this.prisma.user.create({ data: { deviceToken: token } });
    return { token };
  }
}
