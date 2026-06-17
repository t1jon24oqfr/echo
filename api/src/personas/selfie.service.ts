import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PersonasService } from './personas.service';
import { StorageService } from './storage.service';
import { falEditImage, hasFalKey, MIME_BY_EXT } from './fal-edit';

function looksRejected(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('403') ||
    m.includes('forbidden') ||
    m.includes('moderation') ||
    m.includes('content policy') ||
    m.includes('nsfw') ||
    m.includes('rejected') ||
    m.includes('safety')
  );
}

@Injectable()
export class SelfieService {
  private readonly logger = new Logger(SelfieService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly personas: PersonasService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Generate a selfie for the persona, persist it as a ChatMessage (kind 'selfie',
   * role 'assistant') so it shows in history and counts as persona activity.
   * Robust: on a content-moderation / 403 rejection it retries once with an
   * avatar-pack photo; if that also fails -> 422; timeout/other -> 502; no key -> 501.
   */
  async selfie(userId: string, personaId: string, hint?: string): Promise<{ file: string; messageId: string }> {
    if (!hasFalKey()) {
      throw new NotImplementedException({ error: 'FAL_KEY missing' });
    }
    await this.personas.getOwned(userId, personaId);

    const upload = await this.prisma.photo.findFirst({
      where: { personaId, kind: 'upload' },
      orderBy: { createdAt: 'asc' },
    });
    if (!upload) {
      throw new BadRequestException('Upload at least one photo first');
    }

    const prompt = `same person, casual phone selfie, ${hint?.trim() || 'relaxed mood'}, natural lighting, realistic`;

    const imgBuf = await this.generateWithRetry(personaId, upload.file, prompt);

    const file = await this.storage.savePhoto(personaId, `selfie-${Date.now()}.jpg`, imgBuf);
    await this.prisma.photo.create({ data: { personaId, file, kind: 'selfie' } });
    const msg = await this.prisma.chatMessage.create({
      data: { personaId, role: 'assistant', kind: 'selfie', imageFile: file, content: '' },
    });
    await this.prisma.persona.update({
      where: { id: personaId },
      data: { lastPersonaAt: new Date() },
    });
    return { file, messageId: msg.id };
  }

  /** Edit attempt with one avatar-pack fallback on rejection. Throws HttpException on final failure. */
  private async generateWithRetry(personaId: string, sourceFile: string, prompt: string): Promise<Buffer> {
    try {
      return await this.editFromPhoto(personaId, sourceFile, prompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`selfie fal error (primary) for ${personaId}: ${msg}`);
      if (looksRejected(msg)) {
        const avatar = await this.prisma.photo.findFirst({
          where: { personaId, kind: 'avatar' },
          orderBy: { createdAt: 'asc' },
        });
        if (avatar) {
          try {
            return await this.editFromPhoto(personaId, avatar.file, prompt);
          } catch (e2) {
            const msg2 = e2 instanceof Error ? e2.message : String(e2);
            this.logger.error(`selfie fal error (avatar retry) for ${personaId}: ${msg2}`);
          }
        }
        throw new UnprocessableEntityException({
          error: 'photo_rejected',
          message: 'Could not generate from this photo — try a clearer face photo.',
        });
      }
      throw new BadGatewayException({
        error: 'selfie_failed',
        message: 'Could not create a photo right now — please try again in a moment.',
      });
    }
  }

  private async editFromPhoto(personaId: string, file: string, prompt: string): Promise<Buffer> {
    const buf = await this.storage.readPhoto(personaId, file);
    if (!buf) throw new Error('source photo file is missing');
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'image/jpeg';
    return falEditImage(buf, mime, prompt);
  }
}
