import { BadRequestException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { PrismaService } from '../prisma.service';
import { StorageService } from './storage.service';
import { PersonasService } from './personas.service';
import {
  extractVideoFrames,
  prepareImageFrames,
  ImportRejected,
  MAX_FRAMES,
} from '../engine/frames';
import { extractFrames } from '../engine/visualExtract';
import { mergeVisual } from '../engine/visualMerge';
import { segment } from '../engine/segment';
import { computeStats } from '../engine/stats';
import type { Msg } from '../engine/types';

const SOURCE = 'visual';

@Injectable()
export class VisualImportService {
  private readonly logger = new Logger(VisualImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly personas: PersonasService,
  ) {}

  /**
   * Save raw upload(s), flip persona into the 'extracting' stage, and kick off
   * the async pipeline. Returns immediately (the controller answers 202).
   */
  async start(
    userId: string,
    personaId: string,
    input: { video?: Express.Multer.File; images?: Express.Multer.File[] },
  ): Promise<{ status: 'extracting' }> {
    const persona = await this.personas.getOwned(userId, personaId);
    if (persona.status === 'building') {
      throw new BadRequestException('A build is already in progress');
    }

    let videoPath: string | null = null;
    let imagePaths: string[] = [];

    if (input.video) {
      const name = this.storage.sanitizeName(input.video.originalname || `recording-${Date.now()}.mp4`);
      videoPath = await this.storage.saveImport(personaId, name, input.video.buffer);
    } else if (input.images?.length) {
      let i = 0;
      for (const img of input.images) {
        const name = this.storage.sanitizeName(img.originalname || `shot-${String(i).padStart(4, '0')}.jpg`);
        imagePaths.push(await this.storage.saveImport(personaId, `${String(i).padStart(4, '0')}-${name}`, img.buffer));
        i++;
      }
    } else {
      throw new BadRequestException('Upload a screen recording (video) or screenshots (images)');
    }

    await this.prisma.persona.update({
      where: { id: personaId },
      data: { status: 'building', stage: 'extracting' },
    });

    // Fire-and-forget; the persona row + GET /personas/:id is the progress channel.
    void this.run(personaId, { videoPath, imagePaths }).catch(async (e: unknown) => {
      const friendly = e instanceof ImportRejected ? e.message : 'Extraction failed — please try again';
      this.logger.error(`Visual import failed for ${personaId}: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.persona
        .update({ where: { id: personaId }, data: { status: 'failed', stage: `extract:error:${friendly}`.slice(0, 300) } })
        .catch(() => undefined);
      await this.storage.clearImports(personaId).catch(() => undefined);
    });

    return { status: 'extracting' };
  }

  private setStage(personaId: string, stage: string): Promise<unknown> {
    return this.prisma.persona.update({ where: { id: personaId }, data: { stage } }).catch(() => undefined);
  }

  private async run(personaId: string, src: { videoPath: string | null; imagePaths: string[] }): Promise<void> {
    // 1) frames
    await this.setStage(personaId, 'extract:frames');
    let frames: Buffer[];
    if (src.videoPath) {
      const r = await extractVideoFrames(src.videoPath);
      frames = r.frames;
      if (r.truncated) this.logger.warn(`[visual] ${personaId} truncated ${r.rawCount}→${MAX_FRAMES} frames`);
    } else {
      const buffers = await Promise.all(src.imagePaths.map((p) => fs.readFile(p)));
      const r = await prepareImageFrames(buffers);
      frames = r.frames;
      if (r.truncated) this.logger.warn(`[visual] ${personaId} truncated ${r.rawCount}→${MAX_FRAMES} frames`);
    }
    if (!frames.length) throw new ImportRejected('No usable frames — try a slower scroll or clearer screenshots.');

    // 2) per-frame VLM
    await this.setStage(personaId, `extract:reading:0/${frames.length}`);
    const perFrame = await extractFrames(frames, {
      onProgress: (done, total) => {
        if (done % 4 === 0 || done === total) void this.setStage(personaId, `extract:reading:${done}/${total}`);
      },
    });

    // 3) merge
    await this.setStage(personaId, 'extract:merging');
    const merged = mergeVisual(perFrame);
    const messages: Msg[] = merged.messages;
    if (messages.length < 2 || merged.importAuthors.length < 2) {
      throw new ImportRejected('Could not read two people talking — make sure both sides of the chat are visible.');
    }

    // 4) provisional stats over the whole merged set (segment for the day window)
    const conversations = segment(messages); // no month-cutoff: synthetic ts cluster near "now"
    const kept = conversations.flatMap((c) => c.messages);
    const stats = computeStats(kept.length ? kept : messages);

    // Persist pending (messages + authors) so confirm() is instant, plus stats on
    // the persona row so GET /personas/:id can surface the preview before "me".
    await this.storage.writePending(personaId, {
      messages,
      importAuthors: merged.importAuthors,
      source: SOURCE,
      approximate: merged.approximate,
    });

    await this.prisma.persona.update({
      where: { id: personaId },
      data: {
        // reuse 'ingested' to mean "extracted, awaiting which-one-is-you"
        status: 'ingested',
        stage: null,
        stats: JSON.stringify(stats),
        // importAuthors are persisted in stats blob below for the detail view;
        // we keep them in the pending file and re-expose them via detail().
      },
    });

    // Raw video/screenshots no longer needed; keep only the pending corpus.
    if (src.videoPath) await fs.rm(src.videoPath, { force: true }).catch(() => undefined);
    for (const p of src.imagePaths) await fs.rm(p, { force: true }).catch(() => undefined);

    this.logger.log(
      `[visual] ${personaId} extracted ${messages.length} msgs / authors ${merged.importAuthors.map((a) => `${a.name}:${a.count}`).join(', ')}`,
    );
  }

  /**
   * Finalize: caller tells us which derived author is "me". We map the merged
   * messages onto the corpus shape and flip to 'ingested' (real personaAuthor/
   * userAuthor set), mirroring the tail of PersonasService.ingest. Instant —
   * reads the already-stored pending file, no re-extraction.
   */
  async confirm(userId: string, personaId: string, me: string): Promise<Record<string, unknown>> {
    const persona = await this.personas.getOwned(userId, personaId);
    const pending = await this.storage.readPending(personaId);
    if (!pending) {
      throw new BadRequestException('Nothing to confirm — run the visual import first');
    }
    const names = pending.importAuthors.map((a) => a.name);
    if (!me || !names.includes(me)) {
      throw new BadRequestException('Pick which of the two people is you');
    }
    const personaAuthor = names.find((n) => n !== me);
    if (!personaAuthor) {
      throw new UnprocessableEntityException('The chat has only one participant — a dialogue is needed');
    }

    const conversations = segment(pending.messages);
    const kept = conversations.flatMap((c) => c.messages);
    if (!kept.length) throw new UnprocessableEntityException('Too few messages to build from');
    const stats = computeStats(kept);

    await this.storage.writeCorpus(persona.id, {
      source: pending.source,
      personaAuthor,
      userAuthor: me,
      conversations,
      stats,
    });

    await this.prisma.persona.update({
      where: { id: persona.id },
      data: {
        stats: JSON.stringify(stats),
        personaAuthor,
        userAuthor: me,
        status: 'ingested',
        stage: null,
      },
    });

    // pending file consumed; clear the whole import bucket
    await this.storage.clearImports(personaId).catch(() => undefined);

    return { stats, personaAuthor, userAuthor: me, conversations: conversations.length, approximate: pending.approximate };
  }
}
