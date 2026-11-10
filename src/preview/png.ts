import { PNG } from 'pngjs';

const MIN_WIDTH = 256;
const MIN_HEIGHT = 32;
const MAX_WIDTH = 4096;

/** Integer scale so the strip is ≥ 256 px wide (and frames ≥ 32 px tall), but never wider than 4096 px. */
function defaultScale(w: number, h: number, n: number): number {
  const want = Math.max(1, Math.ceil(MIN_WIDTH / (w * n)), Math.ceil(MIN_HEIGHT / h));
  return Math.max(1, Math.min(want, Math.floor(MAX_WIDTH / (w * n))));
}

/** Frames (each w·h·3 RGB) side by side in one PNG, nearest-neighbour scaled. */
export function framesToPngStrip(frames: Uint8Array[], w: number, h: number, scale?: number): Buffer {
  const n = frames.length;
  if (!n) throw new Error('no frames');
  const s = scale ?? defaultScale(w, h, n);
  const png = new PNG({ width: w * n * s, height: h * s });
  const W = png.width;
  frames.forEach((f, i) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = (y * w + x) * 3;
        for (let dy = 0; dy < s; dy++) {
          let dst = ((y * s + dy) * W + (i * w + x) * s) * 4;
          for (let dx = 0; dx < s; dx++, dst += 4) {
            png.data[dst] = f[src] ?? 0;
            png.data[dst + 1] = f[src + 1] ?? 0;
            png.data[dst + 2] = f[src + 2] ?? 0;
            png.data[dst + 3] = 255;
          }
        }
      }
    }
  });
  return PNG.sync.write(png);
}
