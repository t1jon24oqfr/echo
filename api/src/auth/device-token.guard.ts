import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export interface AuthedRequest extends Request {
  user: User;
}

@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    // Photo serving: <img> tags can't set headers, token comes via ?t=
    const header = req.headers['x-device-token'];
    const query = typeof req.query.t === 'string' ? req.query.t : undefined;
    const token = typeof header === 'string' && header ? header : query;
    if (!token) throw new UnauthorizedException('Missing device token');
    const user = await this.prisma.user.findUnique({ where: { deviceToken: token } });
    if (!user) throw new UnauthorizedException('Unknown device token');
    req.user = user;
    return true;
  }
}
