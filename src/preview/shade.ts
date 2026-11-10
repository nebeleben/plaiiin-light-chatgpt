import vm from 'node:vm';
// Byte-identical copy of lampos/portal/shade-runtime.js (scripts/check-vendor.mjs), bundled as text.
import RUNTIME from '../../vendor/shade-runtime.js?raw';

export interface Rgb { r: number; g: number; b: number }
export interface RenderOpts {
  w: number; h: number; frames: number; fps: number;
  params?: Record<string, number>; base?: Rgb;
  /** Wall-clock budget for the whole render (default 3000 ms). */
  timeoutMs?: number;
}
export interface ParamInfo { name: string; min: number; max: number; def: number; desc: string; type: 'range' | 'switch' }
export interface ScriptInfo {
  params: ParamInfo[];
  frameState: Array<{ name: string; def: number }>;
  pixelState: Array<{ name: string; def: number }>;
  mode: 'strip' | 'mirror' | null;
  modeSwitch: boolean;
}

export const MAX_PIXELS = 16384;
export const MAX_FRAMES = 60;

const runtime = new vm.Script(RUNTIME, { filename: 'shade-runtime.js' });

/*
 * Runs inside the sandbox. Input and output cross the boundary only as JSON strings (primitives),
 * so the script never gets hold of a host-realm object (whose constructor chain would lead out),
 * and everything it can run — including error formatting — happens under the vm timeout.
 */
const DRIVER = `
var __call = function (j) {
  try {
    var a = JSON.parse(j);
    if (a.op === 'inspect') return JSON.stringify({ ok: PLShade.parseAnnotations(a.source) });
    var r = PLShade.makeRunner(a.source);
    var out = [];
    for (var f = 0; f < a.frames; f++) {
      out.push(r.render({ w: a.w, h: a.h, frame: f, time: f * 1000 / a.fps, base: a.base, params: a.params }));
    }
    return JSON.stringify({ ok: out });
  } catch (e) {
    var msg;
    try { msg = (e && e.name ? e.name + ': ' : '') + (e && e.message !== undefined ? e.message : e); } catch (_) { msg = 'script error'; }
    return JSON.stringify({ error: String(msg) });
  }
};
`;
const driver = new vm.Script(DRIVER);

/** Run one request in a fresh context (a script can't leave globals behind for the next preview). */
function sandboxed<T>(req: object, timeoutMs: number): T {
  // A null-prototype sandbox: the context's global must not inherit the host's Object (whose
  // constructor chain would hand a script the host Function and with it `process`).
  const ctx = vm.createContext(Object.create(null) as object, { codeGeneration: { strings: true, wasm: false }, microtaskMode: 'afterEvaluate' });
  runtime.runInContext(ctx);
  driver.runInContext(ctx);
  let text: unknown;
  try {
    text = vm.runInContext(`__call(${JSON.stringify(JSON.stringify(req))})`, ctx, { timeout: timeoutMs });
  } catch (e) {
    const m = String((e as { message?: unknown })?.message ?? '');
    if (/timed out/i.test(m)) throw new Error(`script timed out after ${timeoutMs} ms (endless loop?)`);
    throw new Error('script error');
  }
  if (typeof text !== 'string') throw new Error('script error');
  const res = JSON.parse(text) as { ok?: T; error?: string };
  if (res.error !== undefined) throw new Error(res.error);
  return res.ok as T;
}

/** The script's `// @param`, `// @state`, `// @mode` annotations, as the lamp reads them. */
export function inspectScript(source: string): ScriptInfo {
  return sandboxed<ScriptInfo>({ op: 'inspect', source }, 1000);
}

/**
 * Render `frames` frames of a `shade()` script with the lamp's own runtime (vendored
 * shade-runtime.js). Frame f runs at time f·1000/fps ms. Each frame is w·h·3 bytes (RGB, row-major).
 * Throws the script's syntax/runtime error, or a timeout.
 */
export function renderFrames(source: string, opts: RenderOpts): Uint8Array[] {
  const { w, h, frames, fps } = opts;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > MAX_PIXELS) throw new Error(`grid must be at least 1×1 and at most ${MAX_PIXELS} pixels`);
  if (!Number.isInteger(frames) || frames < 1 || frames > MAX_FRAMES) throw new Error(`frames must be 1–${MAX_FRAMES}`);
  if (!(fps > 0)) throw new Error('fps must be > 0');
  const out = sandboxed<number[][]>(
    { op: 'render', source, w, h, frames, fps, params: opts.params ?? {}, ...(opts.base ? { base: opts.base } : {}) },
    opts.timeoutMs ?? 3000,
  );
  return out.map((f) => Uint8Array.from(f, (v) => v | 0));
}
