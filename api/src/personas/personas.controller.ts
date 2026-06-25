import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  NotImplementedException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { cloneVoice, hasTtsKey, TtsUnavailableError } from '../engine/tts';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { DeviceTokenGuard, type AuthedRequest } from '../auth/device-token.guard';
import { PrismaService } from '../prisma.service';
import { BuildService } from './build.service';
import { ChatService } from './chat.service';
import { ChatDto, CreatePersonaDto, EnrichPersonaDto, IngestDto, SelfieDto, SetAvatarDto, UpdatePersonaDto, UpdateProfileDto, VisualConfirmDto } from './dto';
import { PersonasService } from './personas.service';
import { ProfileService } from './profile.service';
import type { CharacterPassport } from '../engine/passport';
import { SelfieService } from './selfie.service';
import { AvatarService } from './avatar.service';
import { StorageService } from './storage.service';
import { ProactiveService } from './proactive.service';
import { VisualImportService } from './visual-import.service';
import type { ChatAttachments } from './chat.service';

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  // iPhone photos arrive as HEIC/HEIF — accept and store; the vision model
  // tolerates them, and the bubble renders the original.
  'image/heic': '.heic',
  'image/heif': '.heif',
};
const AUDIO_EXT_BY_MIME: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/mpga': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/aac': '.aac',
};
const AUDIO_CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
};
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// Visual import: one screen recording OR many screenshots. The frames engine
// re-checks the duration cap; here we only bound bytes/count at the edge.
const MAX_IMPORT_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_IMPORT_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMPORT_IMAGES = 150;
const IMPORT_VIDEO_MIME = /^video\//;
const IMPORT_IMAGE_MIME = /^image\//;

@Controller('personas')
@UseGuards(DeviceTokenGuard)
export class PersonasController {
  constructor(
    private readonly personas: PersonasService,
    private readonly build: BuildService,
    private readonly chat: ChatService,
    private readonly selfie: SelfieService,
    private readonly avatars: AvatarService,
    private readonly storage: StorageService,
    private readonly proactive: ProactiveService,
    private readonly visualImport: VisualImportService,
    private readonly profile: ProfileService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<Record<string, unknown>[]> {
    return this.personas.list(req.user.id);
  }

  @Post()
  @Throttle({ default: { limit: 25, ttl: 3_600_000 } })
  create(@Req() req: AuthedRequest, @Body() dto: CreatePersonaDto): Promise<Record<string, unknown>> {
    return this.personas.create(req.user.id, dto);
  }

  @Get(':id')
  detail(@Req() req: AuthedRequest, @Param('id') id: string): Promise<Record<string, unknown>> {
    return this.personas.detail(req.user.id, id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePersonaDto,
  ): Promise<Record<string, unknown>> {
    return this.personas.update(req.user.id, id, dto);
  }

  // Onboarding enrichment: user-described pet-names / signature phrases / "never
  // say" / traits / episodic anchors / knowledge-cutoff merged into the persona.
  @Post(':id/enrich')
  @Throttle({ default: { limit: 40, ttl: 3_600_000 } })
  enrich(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: EnrichPersonaDto,
  ): Promise<Record<string, unknown>> {
    return this.personas.enrich(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string): Promise<{ ok: true }> {
    return this.personas.remove(req.user.id, id);
  }

  // ---- Character Studio (Phase 1): Character Passport read/edit ----
  @Get(':id/profile')
  getProfile(@Req() req: AuthedRequest, @Param('id') id: string): Promise<Record<string, unknown>> {
    return this.profile.getProfile(req.user.id, id) as unknown as Promise<Record<string, unknown>>;
  }

  @Patch(':id/profile')
  updateProfile(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<Record<string, unknown>> {
    return this.profile.updateProfile(req.user.id, id, {
      passport: dto.passport as Partial<CharacterPassport> | undefined,
      timezone: dto.timezone,
    }) as unknown as Promise<Record<string, unknown>>;
  }

  @Post(':id/profile/regenerate')
  regenerateProfile(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.profile.regenerate(req.user.id, id) as unknown as Promise<Record<string, unknown>>;
  }

  @Post(':id/ingest')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  ingest(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: IngestDto,
  ): Promise<Record<string, unknown>> {
    return this.personas.ingest(req.user.id, id, dto);
  }

  // ---- Visual import (V9): upload a screen recording OR screenshots ----
  @Post(':id/visual-import')
  @Throttle({ default: { limit: 12, ttl: 3_600_000 } })
  @HttpCode(202)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'video', maxCount: 1 },
        { name: 'images', maxCount: MAX_IMPORT_IMAGES },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: MAX_IMPORT_VIDEO_BYTES, files: MAX_IMPORT_IMAGES + 1 },
        fileFilter: (_req, file, cb) => {
          if (file.fieldname === 'video' && IMPORT_VIDEO_MIME.test(file.mimetype)) return cb(null, true);
          if (file.fieldname === 'images' && IMPORT_IMAGE_MIME.test(file.mimetype)) return cb(null, true);
          cb(new BadRequestException('Send a video as "video" or screenshots as "images"'), false);
        },
      },
    ),
  )
  async uploadVisualImport(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @UploadedFiles() files: { video?: Express.Multer.File[]; images?: Express.Multer.File[] } | undefined,
  ): Promise<{ status: 'extracting' }> {
    const video = files?.video?.[0];
    const images = files?.images ?? [];
    if (!video && !images.length) {
      throw new BadRequestException('Upload a screen recording (video) or screenshots (images)');
    }
    if (video && images.length) {
      throw new BadRequestException('Send either a video or screenshots, not both');
    }
    if (images.some((f) => f.size > MAX_IMPORT_IMAGE_BYTES)) {
      throw new BadRequestException('One of the screenshots is too large (max 15MB each)');
    }
    return this.visualImport.start(req.user.id, id, { video, images });
  }

  @Post(':id/visual-import/confirm')
  visualImportConfirm(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: VisualConfirmDto,
  ): Promise<Record<string, unknown>> {
    return this.visualImport.confirm(req.user.id, id, dto.me);
  }

  @Post(':id/photos')
  @Throttle({ default: { limit: 40, ttl: 3_600_000 } })
  @UseInterceptors(
    FilesInterceptor('photos', 12, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype in ALLOWED_MIME) cb(null, true);
        else cb(new BadRequestException('Only JPEG, PNG and WebP images are allowed'), false);
      },
    }),
  )
  async uploadPhotos(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<{ files: string[] }> {
    await this.personas.getOwned(req.user.id, id);
    if (!files?.length) throw new BadRequestException('No photos in the request');
    const saved: string[] = [];
    for (const f of files) {
      const name = f.originalname || `photo${ALLOWED_MIME[f.mimetype]}`;
      const file = await this.storage.savePhoto(id, name, f.buffer);
      await this.prisma.photo.create({ data: { personaId: id, file, kind: 'upload' } });
      saved.push(file);
    }
    return { files: saved };
  }

  @Get(':id/photos/:file')
  @SkipThrottle()
  async servePhoto(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    // Guard already validated ?t= (or header) and set req.user; verify ownership.
    await this.personas.getOwned(req.user.id, id);
    const stream = await this.storage.readPhotoStream(id, file);
    if (!stream) throw new NotFoundException('Photo not found');
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    res.setHeader('Content-Type', CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // Token already checked above — stream the private bytes through the API
    // (R2 GetObject -> pipe); the bucket is never made public.
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.end();
    });
    stream.pipe(res);
  }

  @Post(':id/build')
  @Throttle({ default: { limit: 15, ttl: 3_600_000 } })
  @HttpCode(202)
  startBuild(@Req() req: AuthedRequest, @Param('id') id: string): Promise<{ status: 'building' }> {
    return this.build.start(req.user.id, id);
  }

  @Get(':id/messages')
  messages(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<Record<string, unknown>[]> {
    return this.chat.messages(req.user.id, id, Math.min(Math.max(limit, 1), 500));
  }

  @Post(':id/chat')
  @Throttle({ default: { limit: 50, ttl: 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },
        { name: 'audio', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: MAX_AUDIO_BYTES },
      },
    ),
  )
  async chatSse(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: ChatDto,
    @UploadedFiles() files: { image?: Express.Multer.File[]; audio?: Express.Multer.File[] } | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const attachments: ChatAttachments = {};
    const img = files?.image?.[0];
    if (img) {
      const ext = IMAGE_EXT_BY_MIME[img.mimetype];
      if (!ext) throw new BadRequestException('Only JPEG, PNG and WebP images are allowed');
      if (img.size > MAX_PHOTO_BYTES) throw new BadRequestException('Image too large');
      attachments.image = { buffer: img.buffer, mime: img.mimetype, ext };
    }
    const aud = files?.audio?.[0];
    if (aud) {
      const ext = AUDIO_EXT_BY_MIME[aud.mimetype] ?? '.webm';
      attachments.audio = { buffer: aud.buffer, mime: aud.mimetype, ext };
    }
    const message = typeof body?.message === 'string' ? body.message : '';
    const mode = body?.mode === 'call' ? 'call' : undefined;
    if (!message && !attachments.image && !attachments.audio) {
      throw new BadRequestException('message, image or audio is required');
    }
    await this.chat.chat(req.user.id, id, message, res, attachments, mode);
  }

  @Get(':id/audio/:file')
  @SkipThrottle()
  async serveAudio(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.personas.getOwned(req.user.id, id);
    const stream = await this.storage.readPhotoStream(id, file);
    if (!stream) throw new NotFoundException('Audio not found');
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    res.setHeader('Content-Type', AUDIO_CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // Token already checked above — stream the private bytes through the API.
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.end();
    });
    stream.pipe(res);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@Req() req: AuthedRequest, @Param('id') id: string): Promise<{ ok: true; cleared: number }> {
    return this.personas.markRead(req.user.id, id);
  }

  @Post(':id/nudge-now')
  nudgeNow(@Req() req: AuthedRequest, @Param('id') id: string): Promise<Record<string, unknown>> {
    return this.proactive.nudgeNow(req.user.id, id);
  }

  @Patch(':id/avatar')
  setAvatar(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: SetAvatarDto,
  ): Promise<{ avatarFile: string }> {
    return this.avatars.setAvatar(req.user.id, id, dto.file);
  }

  @Post(':id/selfie')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  takeSelfie(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: SelfieDto,
  ): Promise<{ file: string; messageId: string }> {
    return this.selfie.selfie(req.user.id, id, dto.hint);
  }

  @Post(':id/voice-sample')
  @Throttle({ default: { limit: 15, ttl: 3_600_000 } })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AUDIO_BYTES },
    }),
  )
  async voiceSample(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ ok: true; voiceId: string }> {
    await this.personas.getOwned(req.user.id, id);
    if (!file) throw new BadRequestException('audio file is required');
    const ext = AUDIO_EXT_BY_MIME[file.mimetype];
    if (!ext) throw new BadRequestException('Unsupported audio format');
    if (!hasTtsKey()) throw new NotImplementedException({ error: 'tts_unavailable' });

    const sampleFile = await this.storage.saveAudio(id, `voice-sample-${Date.now()}${ext}`, file.buffer);
    let voiceId: string;
    try {
      voiceId = await cloneVoice(file.buffer, file.mimetype);
    } catch (e) {
      if (e instanceof TtsUnavailableError) throw new NotImplementedException({ error: 'tts_unavailable' });
      throw new BadGatewayException({ error: 'clone_failed' });
    }
    await this.prisma.persona.update({
      where: { id },
      data: { voiceId, voiceSampleFile: sampleFile },
    });
    return { ok: true, voiceId };
  }
}
