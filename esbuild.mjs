import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { build } from 'esbuild';

/** `import text from './file?raw'` → the file's text (the same suffix Vite/vitest understand). */
const raw = {
  name: 'raw',
  setup(b) {
    // path stays relative so the bundle doesn't carry this machine's directory names
    b.onResolve({ filter: /\?raw$/ }, (a) => {
      const abs = resolve(dirname(a.importer), a.path.slice(0, -4));
      return { path: relative(process.cwd(), abs), namespace: 'raw', pluginData: abs };
    });
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.pluginData, 'utf8'), loader: 'text' }));
  },
};

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'plugin/dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  plugins: [raw],
  // CJS dependencies (pngjs, bonjour-service, …) call require() for Node built-ins.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);" },
  legalComments: 'none',
});
