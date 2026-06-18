import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { JwtService } from './jwt.service';

export interface AuthedRequest extends Request {
  user: User;
}

@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();

    // V11: prefer a Bearer access JWT (verify sig+exp -> load User by sub).
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const userId = await this.jwt.verifyAccess(auth.slice(7).trim());
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new UnauthorizedException('Unknown user');
      req.user = user;
      return true;
    }

    // Fallback: legacy x-device-token header, or ?t= for <img>/<audio> byte routes.
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
