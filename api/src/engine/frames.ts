// Frame extraction + dedup for visual chat import.
//
// VIDEO: ffmpeg's mpdecimate drops near-identical frames while a fps cap keeps a
// fast scroll from yielding zero frames; a second JS pass computes a 16x16
// grayscale aHash per frame (via sharp) and drops any frame whose Hamming
// distance to the last KEPT frame is below threshold — collapsing the long runs
// of "same screen" between scroll steps. IMAGES are already discrete so they're
// only downscaled. Every kept frame is downscaled to ~560px-wide JPEG q80 (a
// chat is a narrow column; ~4.5x fewer vision tokens with no real accuracy loss).
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

// Safety caps (tunable via env at call-time, defaults per spec).
export const MAX_FRAMES = Number(process.env.IMPORT_MAX_FRAMES ?? 120);
export const MAX_VIDEO_BYTES = Number(process.env.IMPORT_MAX_VIDEO_BYTES ?? 200 * 1024 * 1024);
export const MAX_VIDEO_SECONDS = Number(process.env.IMPORT_MAX_VIDEO_SECONDS ?? 6 * 60);
const FPS = Number(process.env.IMPORT_FPS ?? 4);
const AHASH_THRESHOLD = Number(process.env.IMPORT_AHASH_THRESHOLD ?? 6);
const TARGET_WIDTH = Number(process.env.IMPORT_FRAME_WIDTH ?? 560);

export interface FrameResult {
  /** Downscaled JPEG buffers in chronological order (scroll order). */
  frames: Buffer[];
  /** Frames produced before the MAX_FRAMES even-sampling truncation. */
  rawCount: number;
  /** True when we had to evenly downsample to fit MAX_FRAMES. */
  truncated: boolean;
}

/** Friendly, user-facing rejection. The controller turns this into a 422/400. */
export class ImportRejected extends Error {}

function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

async function probeDurationSeconds(file: string): Promise<number> {
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn(FFPROBE, [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
      ]);
      let s = '';
      p.stdout.on('data', (d: Buffer) => (s += d.toString()));
      p.on('error', reject);
      p.on('close', () => resolve(s));
    });
    return Number.parseFloat(out.trim()) || 0;
  } catch {
    return 0; // probe is best-effort; size cap still applies
  }
}

/** 16x16 grayscale average-hash → 256-bit fingerprint as a Uint8Array(256). */
async function aHash(buf: Buffer): Promise<Uint8Array> {
  const raw = await sharp(buf).greyscale().resize(16, 16, { fit: 'fill' }).raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < raw.length; i++) sum += raw[i];
  const avg = sum / raw.length;
  const bits = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bits[i] = raw[i] >= avg ? 1 : 0;
  return bits;
}

function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

async function downscaleJpeg(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/** Evenly sample down to MAX_FRAMES, preserving first/last + order. */
function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = items.length / max;
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

/**
 * Extract message-advancing frames from a screen-recording video.
 * Throws ImportRejected for oversize / too-long / unreadable input.
 */
export async function extractVideoFrames(videoPath: string): Promise<FrameResult> {
  const stat = await fs.stat(videoPath);
  if (stat.size > MAX_VIDEO_BYTES) {
    throw new ImportRejected(
      `The video is too large (${(stat.size / 1024 / 1024).toFixed(0)}MB). Please keep it under ${Math.round(
        MAX_VIDEO_BYTES / 1024 / 1024,
      )}MB.`,
    );
  }
  const dur = await probeDurationSeconds(videoPath);
  if (dur > MAX_VIDEO_SECONDS) {
    throw new ImportRejected(
      `The video is too long (${Math.round(dur)}s). Please keep it under ${Math.round(MAX_VIDEO_SECONDS / 60)} minutes.`,
    );
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vimport-'));
  try {
    const vf = `mpdecimate=hi=64*12:lo=64*5:frac=0.33,fps=${FPS}`;
    const { code, stderr } = await run(FFMPEG, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      videoPath,
      '-vf',
      vf,
      '-vsync',
      'vfr',
      path.join(tmp, '%05d.png'),
    ]);
    if (code !== 0) {
      throw new ImportRejected(
        `Could not read the video. Make sure it is a normal screen recording (mp4/mov). ${stderr.slice(0, 200)}`.trim(),
      );
    }

    const names = (await fs.readdir(tmp)).filter((n) => n.endsWith('.png')).sort();
    if (!names.length) {
      throw new ImportRejected('No frames could be extracted from the video.');
    }

    // JS aHash dedup pass against the last KEPT frame.
    const kept: Buffer[] = [];
    let lastHash: Uint8Array | null = null;
    for (const name of names) {
      const png = await fs.readFile(path.join(tmp, name));
      const h = await aHash(png);
      if (lastHash && hamming(lastHash, h) < AHASH_THRESHOLD) continue;
      lastHash = h;
      kept.push(png);
    }

    const rawCount = kept.length;
    const sampled = sampleEvenly(kept, MAX_FRAMES);
    const frames = await Promise.all(sampled.map(downscaleJpeg));
    return { frames, rawCount, truncated: rawCount > MAX_FRAMES };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Prepare discrete screenshots: dedup (in case the user uploads near-duplicates),
 * downscale, cap. Buffers must be in chronological (oldest→newest) order.
 */
export async function prepareImageFrames(images: Buffer[]): Promise<FrameResult> {
  if (!images.length) throw new ImportRejected('No images were uploaded.');
  const kept: Buffer[] = [];
  let lastHash: Uint8Array | null = null;
  for (const img of images) {
    let h: Uint8Array;
    try {
      h = await aHash(img);
    } catch {
      throw new ImportRejected('One of the files is not a readable image.');
    }
    if (lastHash && hamming(lastHash, h) < AHASH_THRESHOLD) continue;
    lastHash = h;
    kept.push(img);
  }
  const rawCount = kept.length;
  const sampled = sampleEvenly(kept, MAX_FRAMES);
  const frames = await Promise.all(sampled.map(downscaleJpeg));
  return { frames, rawCount, truncated: rawCount > MAX_FRAMES };
}
