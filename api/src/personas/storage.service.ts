import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { Corpus, Msg } from '../engine/types';

// ---------------------------------------------------------------------------
// Logical key layout (driver-agnostic). The local driver maps each key under
// ./data; the r2 driver uses it verbatim as the object key in a PRIVATE bucket.
//   corpora/<id>.json                      durable, deleted after build
//   personas/<id>/photos/<file>            durable (photos/audio/selfies/avatars/voice)
//   imports/<id>/<name>                    raw upload (transient)
//   imports/<id>/_pending.json             durable until confirm()
// Raw import binaries (video/screenshots) are kept on a local EPHEMERAL temp
// dir even with the r2 driver: ffmpeg needs a real on-disk path, and they are
// deleted within the same build run, so they never need cross-deploy durability.
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), 'data');
const IMPORT_TMP_ROOT = path.join(os.tmpdir(), 'echo-imports');

const SAFE_NAME = /[^a-zA-Z0-9._-]/g;

type PendingBlob = {
  messages: Msg[];
  importAuthors: { name: string; count: number }[];
  source: string;
  approximate: boolean;
};

@Injectable()
export class StorageService {
  private _s3: S3Client | null = null;

  // STORAGE_DRIVER read at call-time so a process can flip without rebuild.
  private get driver(): 'local' | 'r2' {
    return (process.env.STORAGE_DRIVER ?? 'local').toLowerCase() === 'r2' ? 'r2' : 'local';
  }

  private get bucket(): string {
    return process.env.R2_BUCKET ?? '';
  }

  private s3(): S3Client {
    if (this._s3) return this._s3;
    this._s3 = new S3Client({
      region: process.env.R2_REGION ?? 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      },
      forcePathStyle: true,
    });
    return this._s3;
  }

  sanitizeName(name: string): string {
    const base = path.basename(name).replace(SAFE_NAME, '_');
    return base && base !== '.' && base !== '..' ? base : `photo_${Date.now()}`;
  }

  // ---- key helpers (logical layout shared by both drivers) ----

  private corpusKey(personaId: string): string {
    return `corpora/${this.sanitizeName(personaId)}.json`;
  }

  private photoKey(personaId: string, file: string): string {
    return `personas/${this.sanitizeName(personaId)}/photos/${this.sanitizeName(file)}`;
  }

  private photoPrefix(personaId: string): string {
    return `personas/${this.sanitizeName(personaId)}/photos/`;
  }

  private pendingKey(personaId: string): string {
    return `imports/${this.sanitizeName(personaId)}/_pending.json`;
  }

  // ---- low-level driver dispatch (key -> bytes) ----

  private localPath(key: string): string {
    return path.join(DATA_DIR, ...key.split('/'));
  }

  private async putObject(key: string, body: Buffer): Promise<void> {
    if (this.driver === 'r2') {
      await this.s3().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body }));
      return;
    }
    const p = this.localPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  }

  private async getObject(key: string): Promise<Buffer | null> {
    if (this.driver === 'r2') {
      try {
        const out = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        if (!out.Body) return null;
        return await this.streamToBuffer(out.Body as Readable);
      } catch {
        return null;
      }
    }
    try {
      return await fs.readFile(this.localPath(key));
    } catch {
      return null;
    }
  }

  /** Open a readable stream for a key, or null if missing. Used by serve endpoints. */
  async getObjectStream(key: string): Promise<Readable | null> {
    if (this.driver === 'r2') {
      try {
        const out = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        return (out.Body as Readable) ?? null;
      } catch {
        return null;
      }
    }
    const p = this.localPath(key);
    try {
      await fs.access(p);
    } catch {
      return null;
    }
    const { createReadStream } = await import('node:fs');
    return createReadStream(p);
  }

  private async objectExists(key: string): Promise<boolean> {
    if (this.driver === 'r2') {
      try {
        await this.s3().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    }
    try {
      await fs.access(this.localPath(key));
      return true;
    } catch {
      return false;
    }
  }

  private async deleteObject(key: string): Promise<void> {
    if (this.driver === 'r2') {
      await this.s3()
        .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
        .catch(() => undefined);
      return;
    }
    await fs.rm(this.localPath(key), { force: true }).catch(() => undefined);
  }

  private async deletePrefix(prefix: string): Promise<void> {
    if (this.driver === 'r2') {
      let token: string | undefined;
      do {
        const list = await this.s3()
          .send(
            new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
          )
          .catch(() => null);
        const keys = (list?.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
        if (keys.length) {
          await this.s3()
            .send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }))
            .catch(() => undefined);
        }
        token = list?.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
      return;
    }
    // local: prefix maps to a directory
    await fs.rm(this.localPath(prefix), { recursive: true, force: true }).catch(() => undefined);
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  // ---- Corpus (JSON; durable; deleted after build) ----

  async writeCorpus(personaId: string, corpus: Corpus): Promise<void> {
    await this.putObject(this.corpusKey(personaId), Buffer.from(JSON.stringify(corpus), 'utf8'));
  }

  async readCorpus(personaId: string): Promise<Corpus | null> {
    const buf = await this.getObject(this.corpusKey(personaId));
    if (!buf) return null;
    try {
      return JSON.parse(buf.toString('utf8')) as Corpus;
    } catch {
      return null;
    }
  }

  async corpusExists(personaId: string): Promise<boolean> {
    return this.objectExists(this.corpusKey(personaId));
  }

  async deleteCorpus(personaId: string): Promise<void> {
    await this.deleteObject(this.corpusKey(personaId));
  }

  // ---- Photos / audio / selfies / avatars / voice (durable) ----

  /** Persist an image/audio blob. Returns the bare filename stored in the DB. */
  async savePhoto(personaId: string, name: string, buf: Buffer): Promise<string> {
    let safe = this.sanitizeName(name);
    if (await this.objectExists(this.photoKey(personaId, safe))) {
      const ext = path.extname(safe);
      safe = `${path.basename(safe, ext)}_${Date.now()}${ext}`;
    }
    await this.putObject(this.photoKey(personaId, safe), buf);
    return safe;
  }

  /**
   * Audio lives alongside photos (same prefix) so the existing
   * GET /personas/:id/audio/:file route (readPhoto) serves it unchanged.
   */
  async saveAudio(personaId: string, name: string, buf: Buffer): Promise<string> {
    return this.savePhoto(personaId, name, buf);
  }

  async readPhoto(personaId: string, file: string): Promise<Buffer | null> {
    return this.getObject(this.photoKey(personaId, file));
  }

  /** Streaming read for serve endpoints (GetObject -> pipe). Token already checked. */
  async readPhotoStream(personaId: string, file: string): Promise<Readable | null> {
    return this.getObjectStream(this.photoKey(personaId, file));
  }

  // ---- Visual-import bucket ----
  //
  // Raw uploads are written to a local EPHEMERAL temp dir (ffmpeg needs a real
  // path; deleted within the same build run). The merged-pending JSON is the
  // only durable artifact and goes through the driver.

  importDir(personaId: string): string {
    return path.join(IMPORT_TMP_ROOT, this.sanitizeName(personaId));
  }

  /** Persist a raw upload to local temp; returns its real on-disk path for ffmpeg. */
  async saveImport(personaId: string, name: string, buf: Buffer): Promise<string> {
    const dir = this.importDir(personaId);
    await fs.mkdir(dir, { recursive: true });
    let safe = this.sanitizeName(name);
    try {
      await fs.access(path.join(dir, safe));
      const ext = path.extname(safe);
      safe = `${path.basename(safe, ext)}_${Date.now()}${ext}`;
    } catch {
      // name free
    }
    const full = path.join(dir, safe);
    await fs.writeFile(full, buf);
    return full;
  }

  /** Wipe the raw import temp bucket AND the durable pending blob. */
  async clearImports(personaId: string): Promise<void> {
    await fs.rm(this.importDir(personaId), { recursive: true, force: true }).catch(() => undefined);
    await this.deleteObject(this.pendingKey(personaId));
  }

  async writePending(personaId: string, pending: PendingBlob): Promise<void> {
    await this.putObject(this.pendingKey(personaId), Buffer.from(JSON.stringify(pending), 'utf8'));
  }

  async readPending(personaId: string): Promise<PendingBlob | null> {
    const buf = await this.getObject(this.pendingKey(personaId));
    if (!buf) return null;
    try {
      return JSON.parse(buf.toString('utf8')) as PendingBlob;
    } catch {
      return null;
    }
  }

  // ---- Bulk delete for a persona (cascade cleanup) ----

  async deletePersonaFiles(personaId: string): Promise<void> {
    await this.deletePrefix(this.photoPrefix(personaId));
    await this.clearImports(personaId);
    await this.deleteCorpus(personaId);
  }
}
