import { Body, Controller, HttpCode, HttpException, HttpStatus, Post } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma.service';
import { JwtService, type SessionTokens } from './jwt.service';
import { ClaimService } from './claim.service';
import { EmailOtpService } from './email-otp.service';
import {
  ProviderNotConfiguredError,
  verifyApple,
  verifyGoogle,
  type VerifiedIdentity,
} from './social-verify';

class DeviceDto {
  @IsOptional()
  @IsString()
  token?: string;
}

class SocialDto {
  @IsIn(['apple', 'google'])
  provider!: 'apple' | 'google';

  @IsString()
  idToken!: string;

  @IsOptional()
  @IsString()
  nonce?: string;

  @IsOptional()
  @IsString()
  deviceToken?: string;
}

class EmailStartDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  deviceToken?: string;
}

class EmailVerifyDto {
  @IsEmail()
  email!: string;

  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  deviceToken?: string;
}

class RefreshDto {
  @IsString()
  refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly claim: ClaimService,
    private readonly emailOtp: EmailOtpService,
  ) {}

  // ---- Legacy anonymous device token (kept during transition) ----
  @Post('device')
  async device(@Body() body: DeviceDto): Promise<{ token: string }> {
    if (body.token) {
      const existing = await this.prisma.user.findUnique({ where: { deviceToken: body.token } });
      if (existing && existing.deviceToken) return { token: existing.deviceToken };
    }
    const token = randomBytes(24).toString('hex');
    await this.prisma.user.create({ data: { deviceToken: token } });
    return { token };
  }

  // ---- Social (Apple / Google) ----
  @Post('social')
  async social(@Body() body: SocialDto): Promise<SessionTokens> {
    let verified: VerifiedIdentity;
    try {
      verified =
        body.provider === 'apple'
          ? await verifyApple(body.idToken, body.nonce)
          : await verifyGoogle(body.idToken);
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        throw new HttpException({ error: 'provider_not_configured' }, HttpStatus.NOT_IMPLEMENTED);
      }
      throw new HttpException({ error: 'invalid_id_token' }, HttpStatus.UNAUTHORIZED);
    }
    const user = await this.claim.claimSocial(
      {
        provider: verified.provider,
        sub: verified.sub,
        email: verified.email,
        emailVerified: verified.emailVerified,
        emailIsPrivateRelay: verified.emailIsPrivateRelay,
        // Apple returns its refresh token via the authorization-code flow, not the
        // id_token; the field exists so native flows can pass it through later.
      },
      body.deviceToken,
    );
    return this.jwt.issueSession(user.id);
  }

  // ---- Email magic-link / OTP ----
  @Post('email/start')
  @HttpCode(HttpStatus.OK)
  async emailStart(@Body() body: EmailStartDto): Promise<{ ok: true; devCode?: string }> {
    const { result } = await this.emailOtp.start(body.email);
    return result.devCode ? { ok: true, devCode: result.devCode } : { ok: true };
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  async emailVerify(@Body() body: EmailVerifyDto): Promise<SessionTokens> {
    const ok = await this.emailOtp.verify(body.email, body.code);
    if (!ok) throw new HttpException({ error: 'invalid_code' }, HttpStatus.UNAUTHORIZED);
    const user = await this.claim.claimEmail(body.email, body.deviceToken);
    return this.jwt.issueSession(user.id);
  }

  // ---- Session lifecycle ----
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshDto): Promise<SessionTokens> {
    return this.jwt.rotate(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: RefreshDto): Promise<{ ok: true }> {
    await this.jwt.revoke(body.refreshToken);
    return { ok: true };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Body() body: RefreshDto): Promise<{ ok: true }> {
    // Resolve the user from the presented refresh token, then nuke all of theirs.
    const userId = await this.jwt.userIdForRefresh(body.refreshToken);
    if (userId) await this.jwt.revokeAll(userId);
    return { ok: true };
  }
}
