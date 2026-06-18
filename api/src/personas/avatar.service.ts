import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PersonasService } from './personas.service';
import { StorageService } from './storage.service';
import { falEditImage, hasFalKey, MIME_BY_EXT } from './fal-edit';
import { markGeneratedImage } from './image-mark';

const PACK_SIZE = 3;
const AVATAR_PROMPT =
  'same person, clean portrait headshot, soft natural light, neutral softly-blurred background, friendly relaxed expression, realistic, high quality';

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly personas: PersonasService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Build-time avatar pack: PACK_SIZE clean portraits from the earliest uploaded
   * photo, first success becomes Persona.avatarFile. Best-effort — logs and
   * returns on any problem so the build always reaches 'ready'.
   */
  async generatePack(personaId: string): Promise<void> {
    if (!hasFalKey()) return;

    const source = await this.prisma.photo.findFirst({
      where: { personaId, kind: 'upload' },
      orderBy: { createdAt: 'asc' },
    });
    if (!source) return;
    const buf = await this.storage.readPhoto(personaId, source.file);
    if (!buf) return;

    const ext = source.file.slice(source.file.lastIndexOf('.')).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'image/jpeg';

    let made = 0;
    for (let i = 0; i < PACK_SIZE; i++) {
      try {
        const imgBuf = await falEditImage(buf, mime, AVATAR_PROMPT);
        // AI Act Art. 50: mark the synthetic portrait (machine-readable) before storing.
        const marked = await markGeneratedImage(imgBuf);
        const file = await this.storage.savePhoto(personaId, `avatar-${i + 1}-${Date.now()}.jpg`, marked);
        await this.prisma.photo.create({ data: { personaId, file, kind: 'avatar' } });
        made++;
        if (made === 1) {
          await this.prisma.persona.update({
            where: { id: personaId },
            data: { avatarFile: file },
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`avatar ${i + 1}/${PACK_SIZE} failed for ${personaId}: ${msg}`);
      }
    }
    this.logger.log(`avatar pack for ${personaId}: ${made}/${PACK_SIZE} generated`);
  }

  /** User re-picks the canonical avatar from this persona's photos. */
  async setAvatar(userId: string, personaId: string, file: string): Promise<{ avatarFile: string }> {
    await this.personas.getOwned(userId, personaId);
    const photo = await this.prisma.photo.findFirst({ where: { personaId, file } });
    if (!photo) throw new BadRequestException('No such photo for this persona');
    await this.prisma.persona.update({
      where: { id: personaId },
      data: { avatarFile: file },
    });
    return { avatarFile: file };
  }
}
