import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthController } from './auth/auth.controller';
import { DeviceTokenGuard } from './auth/device-token.guard';
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
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot()],
  controllers: [AuthController, PersonasController, InboxController, ResetController, PushController, HealthController],
  providers: [
    PrismaService,
    DeviceTokenGuard,
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
