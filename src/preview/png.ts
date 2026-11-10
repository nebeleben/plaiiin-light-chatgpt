import { PNG } from 'pngjs';

const MIN_WIDTH = 256;
const MIN_HEIGHT = 32;
export const MAX_STRIP_WIDTH = 4096;

/** Integer scale so the strip is ≥ 256 px wide (and frames ≥ 32 px tall), within 4096 px. */
function defaultScale(w: number, h: number, n: number): number {
  const want = Math.max(1, Math.ceil(MIN_WIDTH / (w * n)), Math.ceil(MIN_HEIGHT / h));
  return Math.max(1, Math.min(want, Math.floor(MAX_STRIP_WIDTH / (w * n))));
}

/**
 * Frames (each w·h·3 RGB) side by side in one PNG, nearest-neighbour scaled. The strip is never
 * wider than 4096 px: frames that don't fit at the chosen scale are left out (at least one is
 * always shown; the caller can tell how many from width / (w·scale)).
 */
export function framesToPngStrip(frames: Uint8Array[], w: number, h: number, scale?: number): Buffer {
  if (!frames.length) throw new Error('no frames');
  const s = scale ?? defaultScale(w, h, frames.length);
  const shown = frames.slice(0, Math.max(1, Math.min(frames.length, Math.floor(MAX_STRIP_WIDTH / (w * s)))));
  const png = new PNG({ width: w * shown.length * s, height: h * s });
  const W = png.width;
  shown.forEach((f, i) => {
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
