import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

export interface ShareLink { host: string; port: number; key: string }

const LINK = /\b(https?):\/\/([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/config\?((?:[^\s#&]*&)*?)t=([^&\s#]+)/;

/** Find `http(s)://host[:port]/config?t=KEY` anywhere in `text` (a share QR's payload or a pasted sentence). */
export function parseShareLink(text: string): ShareLink | undefined {
  const m = LINK.exec(text);
  if (!m) return undefined;
  const [, scheme, host, port, , raw] = m;
  // A trailing sentence period is not part of the key.
  let key: string;
  try { key = decodeURIComponent(raw!.replace(/[.,;:!?)\]]+$/, '')); } catch { return undefined; }
  if (!key) return undefined;
  const p = port ? Number(port) : scheme === 'https' ? 443 : 80;
  if (!(p > 0 && p < 65536)) return undefined;
  return { host: host!, port: p, key };
}

/** Decode a QR code from a PNG or JPEG file; undefined when unreadable or no code found. */
export function decodeQrImage(path: string): string | undefined {
  let buf: Buffer;
  try { buf = readFileSync(path); } catch { return undefined; }
  let img: { width: number; height: number; data: Uint8Array | Buffer };
  try {
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) img = PNG.sync.read(buf);
    else if (buf[0] === 0xff && buf[1] === 0xd8) img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
    else return undefined;
  } catch { return undefined; }
  const data = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return jsQR(data, img.width, img.height)?.data || undefined;
}
