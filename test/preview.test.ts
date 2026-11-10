import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { inspectScript, renderFrames } from '../src/preview/shade';
import { framesToPngStrip } from '../src/preview/png';

const RED = 'function shade(x, y, idx, frame, base, params) { emit(255, 0, 0); }';

describe('renderFrames', () => {
  it('renders an all-red script into w*h*3 frames', () => {
    const frames = renderFrames(RED, { w: 4, h: 3, frames: 5, fps: 10 });
    expect(frames).toHaveLength(5);
    for (const f of frames) {
      expect(f).toBeInstanceOf(Uint8Array);
      expect(f.length).toBe(4 * 3 * 3);
      for (let i = 0; i < f.length; i += 3) expect([f[i], f[i + 1], f[i + 2]]).toEqual([255, 0, 0]);
    }
  });

  it('applies @param defaults and overrides, base color, frame and time (ms)', () => {
    const src = [
      '// @param level 0..255 = 10 brightness',
      'function shade(x, y, idx, frame, base, params) { emit(params.level, frame, (time / 100) | 0); }',
    ].join('\n');
    const def = renderFrames(src, { w: 1, h: 1, frames: 3, fps: 10 });
    expect([...def[2]!]).toEqual([10, 2, 2]);         // frame 2 at 10 fps = 200 ms
    const ov = renderFrames(src, { w: 1, h: 1, frames: 1, fps: 10, params: { level: 99 } });
    expect([...ov[0]!]).toEqual([99, 0, 0]);
    const bright = renderFrames('function shade(){ emitBright(1); }', { w: 1, h: 1, frames: 1, fps: 10, base: { r: 1, g: 2, b: 3 } });
    expect([...bright[0]!]).toEqual([1, 2, 3]);
  });

  it('throws the syntax error', () => {
    expect(() => renderFrames('function shade( {', { w: 2, h: 2, frames: 1, fps: 10 })).toThrow(/SyntaxError|Unexpected/);
    expect(() => renderFrames('var x = 1;', { w: 2, h: 2, frames: 1, fps: 10 })).toThrow(/shade/);
  });

  it('runs the script away from Node: no process/require, and an endless loop times out', () => {
    const f = renderFrames("function shade(){ emit(typeof process === 'undefined' && typeof require === 'undefined' ? 255 : 0, 0, 0); }",
      { w: 1, h: 1, frames: 1, fps: 10 });
    expect(f[0]![0]).toBe(255);
    expect(() => renderFrames('function shade(){ for(;;){} }', { w: 1, h: 1, frames: 1, fps: 10, timeoutMs: 200 })).toThrow(/timed out/);
  });

  it('constructor chains lead nowhere outside the sandbox', () => {
    const attempts = [
      "var g = (function(){ return this; })(); var P = g.constructor.constructor('return typeof process')();",
      "var P = emit.constructor('return typeof process')();",
      "var P = ({}).constructor.constructor('return typeof process')();",
      "var P = (function(){ try { null.x } catch(e) { return e.constructor.constructor('return typeof process')(); } })();",
    ];
    for (const a of attempts) {
      const f = renderFrames(`${a} function shade(){ emit(P === 'undefined' ? 255 : 0, 0, 0); }`, { w: 1, h: 1, frames: 1, fps: 10 });
      expect(f[0]![0], a).toBe(255);
    }
  });

  it('inspectScript lists params and state', () => {
    const info = inspectScript('// @param speed 0..5 = 1 how fast\n// @state t : 0\nfunction shade(){}');
    expect(info.params).toEqual([{ name: 'speed', min: 0, max: 5, def: 1, desc: 'how fast', type: 'range' }]);
    expect(info.frameState).toEqual([{ name: 't', def: 0 }]);
  });
});

describe('framesToPngStrip', () => {
  it('puts the frames side by side, nearest-neighbour scaled', () => {
    const frames = renderFrames(RED, { w: 4, h: 2, frames: 3, fps: 10 });
    const png = PNG.sync.read(framesToPngStrip(frames, 4, 2, 5));
    expect(png.width).toBe(4 * 3 * 5);
    expect(png.height).toBe(2 * 5);
    expect([...png.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('defaults to a scale that makes the strip at least 256 px wide', () => {
    const frames = renderFrames(RED, { w: 8, h: 8, frames: 2, fps: 10 });
    const png = PNG.sync.read(framesToPngStrip(frames, 8, 8));
    expect(png.width).toBeGreaterThanOrEqual(256);
    expect(png.width % 16).toBe(0);
    expect(png.height).toBe(png.width / 2);
  });

  it('keeps distinct pixels where they are', () => {
    const f = new Uint8Array([10, 20, 30, 40, 50, 60]); // 2x1
    const png = PNG.sync.read(framesToPngStrip([f], 2, 1, 2));
    const px = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
    expect(px(0, 0)).toEqual([10, 20, 30]);
    expect(px(1, 1)).toEqual([10, 20, 30]);
    expect(px(2, 0)).toEqual([40, 50, 60]);
    expect(px(3, 1)).toEqual([40, 50, 60]);
  });
});

describe('vendored shade runtime', () => {
  it('check-vendor passes on a clean tree', () => {
    const out = execFileSync(process.execPath, [join(__dirname, '..', 'scripts', 'check-vendor.mjs')], { encoding: 'utf8' });
    expect(out).toMatch(/identical|skipped/);
  });
});
