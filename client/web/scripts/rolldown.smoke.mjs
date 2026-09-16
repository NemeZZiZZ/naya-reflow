// Rolldown config for the smoke bundle: plain rolldown CLI cannot resolve
// Vite's `?raw` suffix, so a tiny loader inlines *.svg?raw as strings
// (same semantics as Vite; also fails the bundle if a file is missing).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export default {
  input: 'scripts/smoke.tsx',
  output: { format: 'cjs', file: '/tmp/smoke.cjs' },
  plugins: [
    {
      name: 'svg-raw-loader',
      resolveId(source, importer) {
        if (source.endsWith('.svg?raw') && importer) {
          return resolve(dirname(importer), source.slice(0, -4)) + '?raw';
        }
        return null;
      },
      load(id) {
        if (id.endsWith('.svg?raw')) {
          const text = readFileSync(id.slice(0, -4), 'utf8');
          return `export default ${JSON.stringify(text)};`;
        }
        return null;
      },
    },
  ],
};
