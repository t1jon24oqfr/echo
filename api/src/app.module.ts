import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { IpThrottlerGuard } from './common/ip-throttler.guard';
import { AuthController } from './auth/auth.controller';
import { DeviceTokenGuard } from './auth/device-token.guard';
import { JwtService } from './auth/jwt.service';
import { ClaimService } from './auth/claim.service';
import { EmailService } from './auth/email.service';
import { EmailOtpService } from './auth/email-otp.service';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { PersonasController } from './personas/personas.controller';
import { InboxController } from './personas/inbox.controller';
import { PersonasService } from './personas/personas.service';
import { BuildService } from './personas/build.service';
import { ChatService } from './personas/chat.service';
import { MemoryService } from './personas/memory.service';
import { SelfieService } from './personas/selfie.service';
import { AvatarService } from './personas/avatar.service';
import { StorageService } from './personas/storage.service';
import { ProactiveService } from './personas/proactive.service';
import { ProfileService } from './personas/profile.service';
import { PersonaStateService } from './personas/persona-state.service';
import { AgendaService } from './personas/agenda.service';
import { VisualImportService } from './personas/visual-import.service';
import { PushController } from './push/push.controller';
import { PushService } from './push/push.service';
import { ResetController } from './reset.controller';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Blanket anti-abuse/DoS limit per client IP (~200 req/min). Cheap GET byte
    // routes opt out with @SkipThrottle; expensive paid POSTs tighten it with
    // @Throttle. In-memory store is fine on the single pod.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 200 }]),
  ],
  controllers: [
    AuthController,
    AccountController,
    PersonasController,
    InboxController,
    ResetController,
    PushController,
    HealthController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
    PrismaService,
    DeviceTokenGuard,
    JwtService,
    ClaimService,
    EmailService,
    EmailOtpService,
    AccountService,
    PersonasService,
    BuildService,
    ChatService,
    MemoryService,
    SelfieService,
    AvatarService,
    StorageService,
    ProactiveService,
    ProfileService,
    PersonaStateService,
    AgendaService,
    VisualImportService,
    PushService,
  ],
})
export class AppModule {}
