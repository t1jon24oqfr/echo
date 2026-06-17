import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { DeviceTokenGuard, type AuthedRequest } from '../auth/device-token.guard';
import { PersonasService } from './personas.service';

// Top-level GET /inbox for badge polling (contract: FEATURES_V2 §5).
@Controller('inbox')
@UseGuards(DeviceTokenGuard)
export class InboxController {
  constructor(private readonly personas: PersonasService) {}

  @Get()
  inbox(@Req() req: AuthedRequest): Promise<Record<string, unknown>> {
    return this.personas.inbox(req.user.id);
  }
}
