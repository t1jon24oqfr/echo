'use client';

/**
 * Extract 3 dominant colors from an image file, client-side.
 * Downscales onto a 32×32 canvas, quantizes to 3-bit buckets,
 * picks the top buckets that are visually distinct and not
 * near-black / near-white (they make poor ambient blobs).
 */
export async function extractAmbientColors(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const cur = buckets.get(key);
      if (cur) {
        cur.r += r;
        cur.g += g;
        cur.b += b;
        cur.n += 1;
      } else {
        buckets.set(key, { r, g, b, n: 1 });
      }
    }

    const candidates = [...buckets.values()]
      .map((v) => ({ r: v.r / v.n, g: v.g / v.n, b: v.b / v.n, n: v.n }))
      .sort((a, b) => b.n - a.n);

    const picked: { r: number; g: number; b: number }[] = [];
    const ok = (c: { r: number; g: number; b: number }) => {
      const lum = (c.r + c.g + c.b) / 3;
      if (lum < 28 || lum > 232) return false; // near-black / near-white
      return picked.every(
        (p) => Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) >= 70,
      );
    };
    for (const c of candidates) {
      if (ok(c)) picked.push(c);
      if (picked.length === 3) break;
    }
    // Relax constraints if the photo is very uniform.
    if (picked.length < 3) {
      for (const c of candidates) {
        if (picked.length === 3) break;
        if (!picked.includes(c)) picked.push(c);
      }
    }
    return picked.slice(0, 3).map((c) => hex(c.r, c.g, c.b));
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}
