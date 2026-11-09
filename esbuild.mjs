import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'plugin/dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
});
