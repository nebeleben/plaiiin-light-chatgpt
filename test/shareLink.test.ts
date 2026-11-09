import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { decodeQrImage, parseShareLink } from '../src/lamp/shareLink';

describe('parseShareLink', () => {
  it('parses a bare link (default port 80)', () => {
    expect(parseShareLink('http://192.168.1.5/config?t=abc')).toEqual({ host: '192.168.1.5', port: 80, key: 'abc' });
  });
  it('finds the link inside a sentence, with a port', () => {
    expect(parseShareLink('Here is my lamp: http://kitchen.local:8080/config?t=k-1_2. Enjoy!'))
      .toEqual({ host: 'kitchen.local', port: 8080, key: 'k-1_2' });
  });
  it('https defaults to 443 and t may follow other params', () => {
    expect(parseShareLink('https://10.0.0.2/config?x=1&t=zz')).toEqual({ host: '10.0.0.2', port: 443, key: 'zz' });
  });
  it('non-matching text → undefined', () => {
    expect(parseShareLink('http://192.168.1.5/api')).toBeUndefined();
    expect(parseShareLink('no link here')).toBeUndefined();
    expect(parseShareLink('http://192.168.1.5/config?t=')).toBeUndefined();
  });
});

describe('decodeQrImage', () => {
  const fx = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
  it('decodes a PNG QR code', () => {
    expect(decodeQrImage(fx('share-qr.png'))).toBe('http://192.168.1.77:8080/config?t=qrkey123');
  });
  it('decodes a JPEG QR code', () => {
    expect(decodeQrImage(fx('share-qr.jpg'))).toBe('http://192.168.1.77:8080/config?t=qrkey123');
  });
  it('PNG without a QR code → undefined', () => {
    const png = new PNG({ width: 40, height: 40 });
    png.data.fill(255);
    const p = join(mkdtempSync(join(tmpdir(), 'lamp-mcp-')), 'blank.png');
    writeFileSync(p, PNG.sync.write(png));
    expect(decodeQrImage(p)).toBeUndefined();
  });
  it('non-image or missing file → undefined', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'lamp-mcp-')), 'x.txt');
    writeFileSync(p, 'hello');
    expect(decodeQrImage(p)).toBeUndefined();
    expect(decodeQrImage(p + '.missing')).toBeUndefined();
  });
});
