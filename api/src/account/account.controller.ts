import { Body, Controller, Delete, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { DeviceTokenGuard, type AuthedRequest } from '../auth/device-token.guard';
import { AccountService, type AccountProfile } from './account.service';

class UpdateAccountDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  ageConfirmed?: boolean;
}

@Controller('account')
@UseGuards(DeviceTokenGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  get(@Req() req: AuthedRequest): Promise<AccountProfile> {
    return this.account.getProfile(req.user.id);
  }

  @Patch()
  update(@Req() req: AuthedRequest, @Body() dto: UpdateAccountDto): Promise<AccountProfile> {
    return this.account.update(req.user.id, dto);
  }

  @Get('export')
  export(@Req() req: AuthedRequest): Promise<Record<string, unknown>> {
    return this.account.export(req.user.id);
  }

  @Delete()
  remove(@Req() req: AuthedRequest): Promise<{ ok: true }> {
    return this.account.delete(req.user.id);
  }
}
