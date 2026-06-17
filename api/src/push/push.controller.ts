import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { DeviceTokenGuard, type AuthedRequest } from '../auth/device-token.guard';
import { PushService, type WebPushSubscription } from './push.service';

interface SubscribeDto {
  subscription: WebPushSubscription;
}
interface UnsubscribeDto {
  endpoint: string;
}

@Controller('push')
@UseGuards(DeviceTokenGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  /** VAPID public key the browser needs to subscribe. `null` when push is not configured. */
  @Get('key')
  key(): { publicKey: string | null } {
    return { publicKey: this.push.publicKey() };
  }

  @Post('subscribe')
  @HttpCode(200)
  async subscribe(@Req() req: AuthedRequest, @Body() dto: SubscribeDto): Promise<{ ok: true }> {
    await this.push.saveSubscription(req.user.id, dto?.subscription);
    return { ok: true };
  }

  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribe(@Req() req: AuthedRequest, @Body() dto: UnsubscribeDto): Promise<{ ok: true }> {
    await this.push.removeSubscription(req.user.id, dto?.endpoint);
    return { ok: true };
  }

  /** Verification helper: push a test notification to the caller's own subscriptions. */
  @Post('test')
  @HttpCode(200)
  async test(@Req() req: AuthedRequest): Promise<{ sent: number }> {
    const sent = await this.push.sendToUser(req.user.id, {
      title: 'Echo',
      body: 'Test notification — push is working.',
      url: '/home',
    });
    return { sent };
  }
}
