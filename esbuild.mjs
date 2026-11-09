import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'plugin/dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // CJS dependencies (pngjs, bonjour-service, …) call require() for Node built-ins.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);" },
  legalComments: 'none',
});
