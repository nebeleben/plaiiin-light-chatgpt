// Preview worker: renders one shade() script and exits. Started by src/preview/shade.ts as
//   node --permission --allow-fs-read=<this file> --max-old-space-size=128 preview-worker.mjs
// with an empty environment, so even a script that escapes the vm below can't write files, start
// processes or workers, or load addons, and runs out of memory here instead of in the server.
// The parent SIGKILLs this process at its wall-clock deadline and only parses what it prints.
//
// stdin:  {"runtime": "<shade-runtime.js text>", "timeoutMs": n,
//          "req": {"op": "inspect"|"render", "source", "w", "h", "frames", "fps", "params", "base"?}}
// stdout: {"ok": {"info": {...}, "frames": ["<base64 w*h*3>", ...]}} | {"error": "<message>"}
import vm from 'node:vm';

// Runs inside the context: the script only ever sees primitives from us, and error formatting
// happens under the vm timeout.
const DRIVER = `
var __call = function (j) {
  try {
    var a = JSON.parse(j);
    var info = PLShade.parseAnnotations(a.source);
    if (a.op === 'inspect') return { info: info };
    var r = PLShade.makeRunner(a.source);
    var out = [];
    for (var f = 0; f < a.frames; f++) {
      out.push(r.render({ w: a.w, h: a.h, frame: f, time: f * 1000 / a.fps, base: a.base, params: a.params }));
    }
    return { info: info, frames: out };
  } catch (e) {
    var msg;
    try { msg = String((e && e.name ? e.name + ': ' : '') + (e && e.message !== undefined ? e.message : e)); } catch (_) { msg = 'script error'; }
    return { error: msg };
  }
};
`;

function plain(v) {
  // Copy the annotation info out field by field: primitives only.
  const num = (x) => (typeof x === 'number' ? x : Number(x));
  const list = (a, f) => (Array.isArray(a) ? Array.from(a, f) : []);
  return {
    params: list(v.params, (p) => ({ name: String(p.name), min: num(p.min), max: num(p.max), def: num(p.def), desc: String(p.desc), type: p.type === 'switch' ? 'switch' : 'range' })),
    frameState: list(v.frameState, (s) => ({ name: String(s.name), def: num(s.def) })),
    pixelState: list(v.pixelState, (s) => ({ name: String(s.name), def: num(s.def) })),
    mode: v.mode === 'strip' || v.mode === 'mirror' ? v.mode : null,
    modeSwitch: v.modeSwitch === true,
  };
}

function run(job) {
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: true, wasm: false }, microtaskMode: 'afterEvaluate' });
  vm.runInContext(job.runtime, ctx, { filename: 'shade-runtime.js' });
  vm.runInContext(DRIVER, ctx);
  const req = job.req;
  let res;
  try {
    res = vm.runInContext(`__call(${JSON.stringify(JSON.stringify(req))})`, ctx, { timeout: job.timeoutMs });
  } catch (e) {
    let m = '';
    try { m = String(e && e.message); } catch { /* the parent's deadline covers getters */ }
    return { error: /timed out/i.test(m) ? 'timeout' : 'script error' };
  }
  if (!res || typeof res !== 'object') return { error: 'script error' };
  if (res.error !== undefined) return { error: String(res.error) };
  const info = plain(res.info || {});
  if (req.op === 'inspect') return { ok: { info } };
  const n = req.w * req.h * 3;
  const frames = [];
  for (let f = 0; f < req.frames; f++) {
    const src = res.frames && res.frames[f];
    if (!src || src.length !== n) return { error: 'script error: bad frame' };
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = Number(src[i]) | 0;
    frames.push(b.toString('base64'));
  }
  return { ok: { info, frames } };
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let out;
  try { out = run(JSON.parse(input)); } catch (e) { out = { error: 'preview worker: bad job' }; }
  process.stdout.write(JSON.stringify(out));
});
